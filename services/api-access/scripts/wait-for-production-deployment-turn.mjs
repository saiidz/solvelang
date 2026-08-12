import { fileURLToPath } from "node:url";

export const PRODUCTION_WORKFLOW_PATHS = Object.freeze([
  ".github/workflows/deploy-api-access-production-customer-accounts.yml",
  ".github/workflows/deploy-api-access-production-foundation.yml",
]);

const ACTIVE_RUN_STATUSES = Object.freeze(["requested", "pending", "waiting", "queued", "in_progress"]);

function positiveSafeInteger(value, label) {
  const integer = Number(value);
  if (!Number.isSafeInteger(integer) || integer <= 0) throw new Error(`${label} must be a positive safe integer.`);
  return integer;
}

function runStart(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a valid timestamp.`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be a valid timestamp.`);
  return { value, milliseconds };
}

function deploymentAttempt(run) {
  const runId = positiveSafeInteger(run.id, "Workflow run ID");
  const runAttempt = positiveSafeInteger(run.run_attempt, "Workflow run attempt");
  const started = runStart(run.run_started_at, "Workflow run start time");
  return {
    runId,
    runAttempt,
    runStartedAt: started.value,
    runStartedAtMilliseconds: started.milliseconds,
  };
}

function compareDeploymentAttempts(left, right) {
  return left.runStartedAtMilliseconds - right.runStartedAtMilliseconds
    || left.runAttempt - right.runAttempt
    || left.runId - right.runId;
}

export function findEarlierActiveProductionRunAttempts(runs, currentRunId, currentRunAttempt) {
  const currentId = positiveSafeInteger(currentRunId, "Current run ID");
  const currentAttemptNumber = positiveSafeInteger(currentRunAttempt, "Current run attempt");
  const productionWorkflows = new Set(PRODUCTION_WORKFLOW_PATHS);
  const activeStatuses = new Set(ACTIVE_RUN_STATUSES);
  const attemptsByIdentity = new Map();

  for (const run of runs) {
    if (!productionWorkflows.has(run.path) || !activeStatuses.has(run.status)) continue;
    const attempt = deploymentAttempt(run);
    const identity = `${attempt.runId}:${attempt.runAttempt}`;
    const existing = attemptsByIdentity.get(identity);
    if (existing && (
      existing.runStartedAt !== attempt.runStartedAt
      || existing.runStartedAtMilliseconds !== attempt.runStartedAtMilliseconds
    )) {
      throw new Error(`Workflow run ${attempt.runId} attempt ${attempt.runAttempt} returned conflicting start times.`);
    }
    attemptsByIdentity.set(identity, attempt);
  }

  const current = attemptsByIdentity.get(`${currentId}:${currentAttemptNumber}`);
  if (!current) throw new Error("Current production deployment attempt was not present in the active Actions metadata.");

  return [...attemptsByIdentity.values()]
    .filter((attempt) => compareDeploymentAttempts(attempt, current) < 0)
    .sort(compareDeploymentAttempts)
    .map(({ runId, runAttempt, runStartedAt }) => ({ runId, runAttempt, runStartedAt }));
}

async function fetchEarlierActiveProductionRunAttempts({
  apiUrl,
  repository,
  token,
  currentRunId,
  currentRunAttempt,
  fetchImpl,
}) {
  const runs = [];

  for (const status of ACTIVE_RUN_STATUSES) {
    for (let page = 1; ; page += 1) {
      const url = new URL(`/repos/${repository}/actions/runs`, apiUrl);
      url.searchParams.set("event", "workflow_dispatch");
      url.searchParams.set("status", status);
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));

      const response = await fetchImpl(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!response.ok) throw new Error(`GitHub Actions queue query failed with HTTP ${response.status}.`);

      const payload = await response.json();
      if (!Array.isArray(payload.workflow_runs)) throw new Error("GitHub Actions queue query returned an invalid response.");
      if (payload.workflow_runs.some((run) => run.status !== status)) {
        throw new Error(`GitHub Actions queue query for ${status} returned mismatched status metadata.`);
      }
      runs.push(...payload.workflow_runs);
      if (payload.workflow_runs.length < 100) break;
    }
  }

  return findEarlierActiveProductionRunAttempts(runs, currentRunId, currentRunAttempt);
}

export async function waitForProductionDeploymentTurn({
  apiUrl,
  repository,
  token,
  currentRunId,
  currentRunAttempt,
  pollMilliseconds = 60_000,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  log = console.log,
}) {
  const runId = positiveSafeInteger(currentRunId, "Current run ID");
  const runAttempt = positiveSafeInteger(currentRunAttempt, "Current run attempt");
  if (!apiUrl || !repository || !token) throw new Error("GitHub API URL, repository, and token are required.");
  if (!Number.isFinite(pollMilliseconds) || pollMilliseconds < 0) throw new Error("Poll interval must be non-negative.");

  for (;;) {
    const earlierAttempts = await fetchEarlierActiveProductionRunAttempts({
      apiUrl,
      repository,
      token,
      currentRunId: runId,
      currentRunAttempt: runAttempt,
      fetchImpl,
    });

    if (earlierAttempts.length === 0) {
      log(`Production deployment run ${runId} attempt ${runAttempt} has the production deployment turn.`);
      return;
    }

    const descriptions = earlierAttempts.map(({ runId: earlierRunId, runAttempt: earlierRunAttempt }) => (
      `${earlierRunId} attempt ${earlierRunAttempt}`
    ));
    log(`Production deployment run ${runId} attempt ${runAttempt} is waiting for earlier attempts: ${descriptions.join(", ")}.`);
    await sleep(pollMilliseconds);
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  const pollSeconds = Number(process.env.PRODUCTION_DEPLOYMENT_QUEUE_POLL_SECONDS ?? "60");
  if (!Number.isInteger(pollSeconds) || pollSeconds < 5 || pollSeconds > 300) {
    throw new Error("PRODUCTION_DEPLOYMENT_QUEUE_POLL_SECONDS must be an integer from 5 through 300.");
  }

  await waitForProductionDeploymentTurn({
    apiUrl: requiredEnvironment("GITHUB_API_URL"),
    repository: requiredEnvironment("GITHUB_REPOSITORY"),
    token: requiredEnvironment("GITHUB_TOKEN"),
    currentRunId: requiredEnvironment("GITHUB_RUN_ID"),
    currentRunAttempt: requiredEnvironment("GITHUB_RUN_ATTEMPT"),
    pollMilliseconds: pollSeconds * 1_000,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
