import { fileURLToPath } from "node:url";

export const PRODUCTION_WORKFLOW_PATHS = Object.freeze([
  ".github/workflows/deploy-api-access-production-customer-accounts.yml",
  ".github/workflows/deploy-api-access-production-foundation.yml",
]);

const ACTIVE_RUN_STATUSES = Object.freeze(["requested", "pending", "waiting", "queued", "in_progress"]);

function numericRunId(value, label) {
  const runId = Number(value);
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error(`${label} must be a positive safe integer.`);
  return runId;
}

export function findEarlierActiveProductionRunIds(runs, currentRunId) {
  const current = numericRunId(currentRunId, "Current run ID");
  const productionWorkflows = new Set(PRODUCTION_WORKFLOW_PATHS);
  const activeStatuses = new Set(ACTIVE_RUN_STATUSES);
  const earlierRunIds = new Set();

  for (const run of runs) {
    const runId = numericRunId(run.id, "Workflow run ID");
    if (runId < current && productionWorkflows.has(run.path) && activeStatuses.has(run.status)) {
      earlierRunIds.add(runId);
    }
  }

  return [...earlierRunIds].sort((left, right) => left - right);
}

async function fetchEarlierActiveProductionRunIds({ apiUrl, repository, token, currentRunId, fetchImpl }) {
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
      runs.push(...payload.workflow_runs);
      if (payload.workflow_runs.length < 100) break;
    }
  }

  return findEarlierActiveProductionRunIds(runs, currentRunId);
}

export async function waitForProductionDeploymentTurn({
  apiUrl,
  repository,
  token,
  currentRunId,
  pollMilliseconds = 60_000,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  log = console.log,
}) {
  numericRunId(currentRunId, "Current run ID");
  if (!apiUrl || !repository || !token) throw new Error("GitHub API URL, repository, and token are required.");
  if (!Number.isFinite(pollMilliseconds) || pollMilliseconds < 0) throw new Error("Poll interval must be non-negative.");

  for (;;) {
    const earlierRunIds = await fetchEarlierActiveProductionRunIds({
      apiUrl,
      repository,
      token,
      currentRunId,
      fetchImpl,
    });

    if (earlierRunIds.length === 0) {
      log(`Production deployment run ${currentRunId} has the production deployment turn.`);
      return;
    }

    log(`Production deployment run ${currentRunId} is waiting for earlier run IDs: ${earlierRunIds.join(", ")}.`);
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
    pollMilliseconds: pollSeconds * 1_000,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
