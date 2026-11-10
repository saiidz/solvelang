// Data-shaping helpers for the Live Center board. The board JSON comes
// from the Merge Governance pilot through the api-access proxy unchanged;
// these helpers normalize it defensively into exactly what the page
// renders, so a missing or partial section degrades to an empty state
// instead of breaking the whole board.
//
// The pilot payload is one board object: `queue` (the governed pull
// requests, in queue order), `checks` (per-PR check summaries keyed by
// PR number), `activity` (recent workflow runs with their jobs and
// runner names), `ownerActions` (what is waiting on the owner, per PR),
// and `batches` (the batch planner's current proposal). Everything the
// v2 board shows — stat tiles, pipeline stages, rich PR rows, grouped
// owner actions, the batch story — is derived here from that payload;
// nothing is invented: a field the payload does not carry stays empty.

export type LiveCenterStage = "queue" | "checking" | "failing" | "ready";

export type LiveCenterQueueEntry = {
  number: number | null;
  title: string;
  position: number;
  state: string;
  author: string;
  draft: boolean;
};

export type LiveCenterPullRequest = {
  number: number | null;
  title: string;
  author: string;
  draft: boolean;
  position: number;
  mergeableState: string;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  failing: string[];
  stage: LiveCenterStage;
  needsOwner: boolean;
};

export type LiveCenterStats = {
  openPrs: number;
  drafts: number;
  failingPrs: number;
  checkingPrs: number;
  readyPrs: number;
  waitingOnOwner: number;
};

export type LiveCenterActivityRow = {
  runId: number | null;
  workflowName: string;
  name: string;
  runnerName: string;
  status: string;
};

// Legacy flat job shape, kept as an alias of the activity rows so the
// pre-v2 board component keeps typechecking until the stacked UI PR
// replaces it.
export type LiveCenterJob = {
  name: string;
  runnerName: string;
  status: string;
};

export type LiveCenterOwnerAction = {
  label: string;
  waitingOn: string;
};

export type LiveCenterOwnerActionItem = {
  number: number | null;
  title: string;
  failing: string[];
};

export type LiveCenterOwnerActionGroup = {
  key: string;
  label: string;
  items: LiveCenterOwnerActionItem[];
};

export type LiveCenterBatchMember = {
  number: number | null;
  title: string;
};

export type LiveCenterBatch = {
  proposed: boolean;
  size: number;
  batchSize: number;
  baseRef: string;
  members: LiveCenterBatchMember[];
  blockedBy: LiveCenterBatchMember | null;
  stoppedReason: string;
};

export type LiveCenterBoardView = {
  repoLabel: string;
  generatedAt: string;
  stats: LiveCenterStats;
  queue: LiveCenterQueueEntry[];
  pullRequests: LiveCenterPullRequest[];
  jobs: LiveCenterJob[];
  activity: LiveCenterActivityRow[];
  ownerActions: LiveCenterOwnerAction[];
  ownerActionGroups: LiveCenterOwnerActionGroup[];
  batch: LiveCenterBatch;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = asText(record[key]);
    if (text) return text;
  }
  return "";
}

function authorOf(record: Record<string, unknown>): string {
  const direct = asText(record.author);
  if (direct) return direct;
  const nested = asRecord(record.author);
  return firstText(nested, ["login", "name"]);
}

// A check counts as passed only on an explicit success, failed on an
// explicit failure conclusion, and pending in every other state (queued,
// in progress, or not yet reported) — the board never guesses a pass.
export function summarizeChecks(checks: unknown): { passed: number; failed: number; pending: number; failing: string[] } {
  if (Array.isArray(checks)) {
    let passed = 0;
    let failed = 0;
    let pending = 0;
    const failing: string[] = [];
    for (const item of checks) {
      const check = asRecord(item);
      const verdict = (asText(check.conclusion) || asText(check.status)).toLowerCase();
      const name = firstText(check, ["name", "title", "context"]) || "Unnamed check";
      if (verdict === "success" || verdict === "passed") {
        passed += 1;
      } else if (["failure", "failed", "timed_out", "action_required", "cancelled"].includes(verdict)) {
        failed += 1;
        failing.push(name);
      } else {
        pending += 1;
      }
    }
    return { passed, failed, pending, failing };
  }
  const summary = asRecord(checks);
  const failingRaw = summary.failing ?? summary.failingChecks ?? summary.failedNames;
  return {
    passed: asCount(summary.passed ?? summary.success),
    failed: asCount(summary.failed ?? summary.failure),
    pending: asCount(summary.pending ?? summary.running ?? summary.queued),
    failing: asArray(failingRaw).map((name) => asText(name)).filter(Boolean),
  };
}

// Pipeline stage for one PR, derived only from its check summary and
// draft flag. A failure outranks still-running checks; a draft whose
// checks all pass is still "in queue" — it is waiting on its author,
// which the owner-actions section says out loud.
export function stageForPullRequest(input: {
  draft: boolean;
  total: number;
  passed: number;
  failed: number;
  pending: number;
}): LiveCenterStage {
  if (input.failed > 0) return "failing";
  if (input.pending > 0) return "checking";
  if (input.total > 0 && input.passed >= input.total && !input.draft) return "ready";
  return "queue";
}

export const LIVE_CENTER_STAGES: { id: LiveCenterStage; label: string }[] = [
  { id: "queue", label: "In queue" },
  { id: "checking", label: "Checking" },
  { id: "failing", label: "Failing" },
  { id: "ready", label: "Ready" },
];

export function groupPullRequestsByStage(
  pullRequests: LiveCenterPullRequest[],
): { stage: LiveCenterStage; label: string; pullRequests: LiveCenterPullRequest[] }[] {
  return LIVE_CENTER_STAGES.map(({ id, label }) => ({
    stage: id,
    label,
    pullRequests: pullRequests.filter((pr) => pr.stage === id),
  }));
}

export type LiveCenterPullRequestFilter = "all" | "failing" | "drafts" | "waiting";

export function filterLiveCenterPullRequests(
  pullRequests: LiveCenterPullRequest[],
  query: string,
  filter: LiveCenterPullRequestFilter,
): LiveCenterPullRequest[] {
  const needle = query.trim().toLowerCase().replace(/^#/, "");
  return pullRequests.filter((pr) => {
    if (filter === "failing" && pr.stage !== "failing") return false;
    if (filter === "drafts" && !pr.draft) return false;
    if (filter === "waiting" && !pr.needsOwner) return false;
    if (!needle) return true;
    if (pr.number !== null && String(pr.number).includes(needle)) return true;
    if (pr.title.toLowerCase().includes(needle)) return true;
    if (pr.author.toLowerCase().includes(needle)) return true;
    return false;
  });
}

// One-line status for an activity row: a job still moving says so, a
// finished job reports its conclusion, and nothing is dressed up as a
// pass it did not earn.
export function activityStatusLabel(status: unknown, conclusion: unknown): string {
  const state = asText(status).toLowerCase();
  const verdict = asText(conclusion).toLowerCase();
  if (state === "in_progress") return "Running";
  if (state === "queued") return "Queued";
  if (state === "waiting") return "Waiting";
  if (state === "requested") return "Requested";
  if (state === "completed") {
    if (verdict === "success") return "Passed";
    if (verdict === "failure" || verdict === "timed_out" || verdict === "action_required") return "Failed";
    if (verdict === "cancelled") return "Cancelled";
    if (verdict === "skipped") return "Skipped";
    return "Completed";
  }
  return asText(status);
}

const FAILING_CHECKS_PREFIX = "Failing checks:";

// The pilot packs an owner action's failing checks into one comma-joined
// `waitingOn` string ("Failing checks: a, b, c"). Splitting it back into
// names here is what lets the page render chips instead of a comma wall,
// and gives every action a stable group label.
export function parseOwnerActionWaitingOn(waitingOn: string): { label: string; failing: string[] } {
  const text = waitingOn.trim();
  if (text.startsWith(FAILING_CHECKS_PREFIX)) {
    const rest = text.slice(FAILING_CHECKS_PREFIX.length);
    return {
      label: "Failing checks",
      failing: rest.split(",").map((name) => name.trim()).filter(Boolean),
    };
  }
  return { label: text, failing: [] };
}

export function normalizeLiveCenterBoard(raw: unknown): LiveCenterBoardView {
  const board = asRecord(raw);
  const checksByNumber = asRecord(board.checks);

  const rawQueue = asArray(board.queue ?? board.mergeQueue);
  const titleByNumber = new Map<number, string>();
  for (const item of rawQueue) {
    const entry = asRecord(item);
    const pr = asRecord(entry.pullRequest);
    const number = asNumber(entry.number ?? entry.prNumber ?? pr.number);
    const title = firstText(entry, ["title"]) || asText(pr.title);
    if (number !== null && title) titleByNumber.set(number, title);
  }

  const rawActions = asArray(board.ownerActions ?? board.owner_actions);
  const ownerPrNumbers = new Set<number>();
  for (const item of rawActions) {
    const action = asRecord(item);
    const number = asNumber(action.pr ?? action.number ?? action.prNumber);
    if (number !== null) ownerPrNumbers.add(number);
  }

  const pullRequests: LiveCenterPullRequest[] = rawQueue.map((item, index) => {
    const entry = asRecord(item);
    const pr = asRecord(entry.pullRequest);
    const number = asNumber(entry.number ?? entry.prNumber ?? pr.number);
    const summary = summarizeChecks(
      (number !== null ? checksByNumber[String(number)] ?? checksByNumber[number] : undefined) ??
        entry.checks ??
        pr.checks ??
        pr.checkRuns,
    );
    const total = summary.passed + summary.failed + summary.pending;
    const draft = entry.draft === true || pr.draft === true;
    return {
      number,
      title: firstText(entry, ["title"]) || asText(pr.title),
      author: authorOf(entry) || authorOf(pr),
      draft,
      position: asNumber(entry.position) ?? index + 1,
      mergeableState: firstText(entry, ["mergeableState", "state", "status"]),
      total,
      ...summary,
      stage: stageForPullRequest({ draft, total, ...summary }),
      needsOwner: number !== null && ownerPrNumbers.has(number),
    };
  });

  // Legacy fallback: a board that carries its PRs outside the queue
  // still renders them (without queue-only fields) instead of an
  // empty list.
  if (pullRequests.length === 0) {
    for (const [index, item] of asArray(board.pullRequests ?? board.pull_requests).entries()) {
      const pr = asRecord(item);
      const summary = summarizeChecks(pr.checks ?? pr.checkRuns);
      const total = summary.passed + summary.failed + summary.pending;
      const number = asNumber(pr.number ?? pr.prNumber);
      pullRequests.push({
        number,
        title: asText(pr.title),
        author: authorOf(pr),
        draft: pr.draft === true,
        position: index + 1,
        mergeableState: firstText(pr, ["mergeableState", "state", "status"]),
        total,
        ...summary,
        stage: stageForPullRequest({ draft: pr.draft === true, total, ...summary }),
        needsOwner: number !== null && ownerPrNumbers.has(number),
      });
    }
  }

  const queue: LiveCenterQueueEntry[] = pullRequests.map((pr) => ({
    number: pr.number,
    title: pr.title,
    position: pr.position,
    state: pr.mergeableState,
    author: pr.author,
    draft: pr.draft,
  }));

  const activity: LiveCenterActivityRow[] = [];
  for (const item of asArray(board.activity ?? board.runs)) {
    const run = asRecord(item);
    const workflowName = firstText(run, ["workflowName", "name"]) || "Workflow run";
    const runJobs = asArray(run.jobs);
    if (runJobs.length === 0) {
      activity.push({
        runId: asNumber(run.runId ?? run.id),
        workflowName,
        name: workflowName,
        runnerName: firstText(run, ["runnerName", "runner_name", "runner"]),
        status: activityStatusLabel(run.status ?? run.state, run.conclusion),
      });
      continue;
    }
    for (const jobItem of runJobs) {
      const job = asRecord(jobItem);
      activity.push({
        runId: asNumber(run.runId ?? run.id),
        workflowName,
        name: firstText(job, ["name", "jobName"]) || workflowName,
        runnerName: firstText(job, ["runnerName", "runner_name", "runner"]),
        status: activityStatusLabel(job.status ?? job.state, job.conclusion),
      });
    }
  }
  if (activity.length === 0) {
    for (const item of asArray(board.jobs ?? board.runners ?? board.runnersAtWork)) {
      const job = asRecord(item);
      activity.push({
        runId: null,
        workflowName: "",
        name: firstText(job, ["name", "jobName", "workflowName"]) || "Job",
        runnerName: firstText(job, ["runner_name", "runnerName", "runner"]),
        status: activityStatusLabel(job.status ?? job.state, job.conclusion) || firstText(job, ["status", "state"]),
      });
    }
  }

  const ownerActions: LiveCenterOwnerAction[] = [];
  const ownerActionGroups: LiveCenterOwnerActionGroup[] = [];
  const groupByKey = new Map<string, LiveCenterOwnerActionGroup>();
  for (const item of rawActions) {
    const action = asRecord(item);
    const number = asNumber(action.pr ?? action.number ?? action.prNumber);
    const title = asText(action.title) || (number !== null ? titleByNumber.get(number) ?? "" : "");
    const waitingOn = firstText(action, ["waitingOn", "waiting_on", "description", "reason"]);
    const label = number !== null ? `#${number}${title ? ` ${title}` : ""}` : title;
    ownerActions.push({ label, waitingOn });

    const parsed = parseOwnerActionWaitingOn(waitingOn);
    const key = parsed.label || waitingOn;
    let group = groupByKey.get(key);
    if (!group) {
      group = { key, label: parsed.label, items: [] };
      groupByKey.set(key, group);
      ownerActionGroups.push(group);
    }
    group.items.push({ number, title, failing: parsed.failing });
  }

  const batchRecord = asRecord(board.batches ?? board.batch);
  const memberNumbers = asArray(batchRecord.prNumbers ?? batchRecord.pr_numbers)
    .map((value) => asNumber(value))
    .filter((value): value is number => value !== null);
  const blockedByNumber = asNumber(batchRecord.blockedBy ?? batchRecord.blocked_by);
  const batch: LiveCenterBatch = {
    proposed: memberNumbers.length > 0,
    size: asCount(batchRecord.size) || memberNumbers.length,
    batchSize: asCount(batchRecord.batchSize ?? batchRecord.batch_size),
    baseRef: asText(batchRecord.baseRef ?? batchRecord.base_ref),
    members: memberNumbers.map((number) => ({ number, title: titleByNumber.get(number) ?? "" })),
    blockedBy:
      blockedByNumber !== null
        ? { number: blockedByNumber, title: titleByNumber.get(blockedByNumber) ?? "" }
        : null,
    stoppedReason: asText(batchRecord.stoppedReason ?? batchRecord.stopped_reason),
  };

  const stats: LiveCenterStats = {
    openPrs: pullRequests.length,
    drafts: pullRequests.filter((pr) => pr.draft).length,
    failingPrs: pullRequests.filter((pr) => pr.stage === "failing").length,
    checkingPrs: pullRequests.filter((pr) => pr.stage === "checking").length,
    readyPrs: pullRequests.filter((pr) => pr.stage === "ready").length,
    waitingOnOwner: ownerActions.length,
  };

  return {
    repoLabel: firstText(board, ["repo", "repository", "repoFullName"]),
    generatedAt: asText(board.generatedAt),
    stats,
    queue,
    pullRequests,
    jobs: activity.map((row) => ({ name: row.name, runnerName: row.runnerName, status: row.status })),
    activity,
    ownerActions,
    ownerActionGroups,
    batch,
  };
}
