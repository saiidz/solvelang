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
// and `batches` (the batch planner's current proposal). Payload v2 adds
// `checkDetails` (every check's own row per PR), a server-computed
// `stage` per PR from the corrected Ready definition (the required
// gate registered green on the current head, the full battery
// terminal, the base the default branch, not a draft), `gate` and
// `review` state per PR, `history` (merged/removed lists plus the
// daily series), and a `pagination` block. Everything the board shows
// — stat tiles, pipeline stages, rich PR rows, grouped owner actions,
// the batch story, the statistics history — is derived here from that
// payload; nothing is invented: a field the payload does not carry
// stays empty, and for older payloads without a server stage the
// stage falls back to the local derivation below.

export type LiveCenterStage = "queue" | "checking" | "failing" | "ready";

export type LiveCenterQueueEntry = {
  number: number | null;
  title: string;
  position: number;
  state: string;
  author: string;
  draft: boolean;
  stage: LiveCenterStage;
  baseRef: string;
  headRef: string;
};

export type LiveCenterCheckRun = {
  name: string;
  kind: string;
  status: string;
  conclusion: string;
  required: boolean | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string;
};

export type LiveCenterReviewState = "approved" | "changes_requested" | "review_required" | "none";

export type LiveCenterReview = {
  state: LiveCenterReviewState;
  approvals: string[];
  changesRequestedBy: string[];
  requestedReviewers: string[];
};

export type LiveCenterGateState = "passed" | "failing" | "pending" | "missing" | "unknown";

export type LiveCenterGate = {
  state: LiveCenterGateState;
  checks: string[];
};

export type LiveCenterPullRequest = {
  number: number | null;
  title: string;
  author: string;
  draft: boolean;
  position: number;
  mergeableState: string;
  mergeable: boolean | null;
  headSha: string;
  headRef: string;
  baseRef: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  comments: number;
  isStackChild: boolean;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  failing: string[];
  checkRuns: LiveCenterCheckRun[];
  review: LiveCenterReview;
  gate: LiveCenterGate;
  stage: LiveCenterStage;
  needsOwner: boolean;
};

export type LiveCenterStats = {
  openPrs: number;
  drafts: number;
  failingPrs: number;
  checkingPrs: number;
  readyPrs: number;
  inQueuePrs: number;
  waitingOnOwner: number;
  waitingOnYou: number;
};

export type LiveCenterActivityRow = {
  runId: number | null;
  workflowName: string;
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

export type LiveCenterJob = {
  id: number | null;
  name: string;
  status: string;
  rawStatus: string;
  conclusion: string;
  runnerName: string;
  labels: string[];
  startedAt: string;
  completedAt: string;
};

export type LiveCenterRun = {
  runId: number | null;
  workflowName: string;
  status: string;
  rawStatus: string;
  conclusion: string;
  headSha: string;
  headBranch: string;
  event: string;
  createdAt: string;
  updatedAt: string;
  pullRequestNumbers: number[];
  jobs: LiveCenterJob[];
};

export type LiveCenterRunnerView = {
  busy: { name: string; jobName: string; workflowName: string }[];
  runningUnassigned: number;
  queuedJobs: { name: string; workflowName: string }[];
  busyCount: number;
  waitingCount: number;
};

export type LiveCenterHistoryEntry = {
  number: number | null;
  title: string;
  at: string;
  queueTimeMs: number | null;
  reason: string;
};

export type LiveCenterHistoryDay = {
  day: string;
  entered: number;
  merged: number;
  removed: number;
  mergedRatePct: number | null;
  queueTimeMedianMs: number | null;
  openPrs: number | null;
  failingPrs: number | null;
  checksPassed: number | null;
  checksFailed: number | null;
  checksPending: number | null;
  runtimeMedianMs: number | null;
};

export type LiveCenterHistory = {
  merged: LiveCenterHistoryEntry[];
  removed: LiveCenterHistoryEntry[];
  daily: LiveCenterHistoryDay[];
  period: { days: number; entered: number; merged: number; removed: number };
};

export type LiveCenterInboxItem = {
  number: number | null;
  title: string;
  blocker: string;
  passed: number;
  total: number;
  updatedAt: string;
  runId: number | null;
};

export type LiveCenterInboxGroup = {
  key: string;
  label: string;
  description: string;
  items: LiveCenterInboxItem[];
};

export type LiveCenterPagination = {
  total: number;
  page: number;
  perPage: number;
  pages: number;
};

export type LiveCenterBoardView = {
  repoLabel: string;
  generatedAt: string;
  defaultBranch: string;
  stats: LiveCenterStats;
  queue: LiveCenterQueueEntry[];
  pullRequests: LiveCenterPullRequest[];
  activity: LiveCenterActivityRow[];
  runs: LiveCenterRun[];
  runners: LiveCenterRunnerView;
  ownerActions: LiveCenterOwnerAction[];
  ownerActionGroups: LiveCenterOwnerActionGroup[];
  inboxGroups: LiveCenterInboxGroup[];
  history: LiveCenterHistory;
  pagination: LiveCenterPagination;
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

export const LIVE_CENTER_STAGE_LABELS: Record<LiveCenterStage, string> = {
  queue: "In queue",
  checking: "Checking",
  failing: "Failing",
  ready: "Ready",
};

export function reviewStateLabel(state: LiveCenterReviewState): string {
  switch (state) {
    case "approved":
      return "Approved";
    case "changes_requested":
      return "Changes requested";
    case "review_required":
      return "Review requested";
    default:
      return "No review yet";
  }
}

export function gateStateLabel(state: LiveCenterGateState): string {
  switch (state) {
    case "passed":
      return "Required gate passed";
    case "failing":
      return "Required gate failed";
    case "pending":
      return "Required gate still running";
    case "missing":
      return "Required gate has not reported yet";
    default:
      return "Required gate not reported";
  }
}

// "3h ago" / "2d ago" — the board's relative stamps. Anything under a
// minute is "just now"; anything unparsable stays empty rather than
// dressing a bad value up as a time.
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso || "");
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// Compact durations for check rows and queue times: "45s", "3m 20s",
// "1h 5m", "2d 4h". A missing duration is an em dash — the board
// never invents a duration it was not given.
export function formatDurationMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function shortSha(sha: string): string {
  return sha ? sha.slice(0, 7) : "";
}

export const LIVE_CENTER_PAGE_SIZE = 25;

// One page of a long list, GitHub-style: the caller renders the
// numbered pager from { page, pages, total } and the rows from
// `items`. An out-of-range page clamps to the last page instead of
// showing an empty list.
export function paginateList<T>(
  items: T[],
  page: number,
  perPage: number = LIVE_CENTER_PAGE_SIZE,
): { items: T[]; page: number; pages: number; total: number } {
  const total = items.length;
  const size = perPage > 0 ? perPage : LIVE_CENTER_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return {
    items: items.slice((current - 1) * size, current * size),
    page: current,
    pages,
    total,
  };
}

export type LiveCenterPullRequestFilter = "all" | "failing" | "drafts" | "waiting";

// The rebuilt board's filter set: the original four plus the two
// stage filters the tabbed design adds. Kept as a separate, wider
// type so existing consumers typed against the original union keep
// compiling unchanged.
export type LiveCenterBoardFilter = LiveCenterPullRequestFilter | "checking" | "ready";

export function filterLiveCenterPullRequests(
  pullRequests: LiveCenterPullRequest[],
  query: string,
  filter: LiveCenterBoardFilter,
): LiveCenterPullRequest[] {
  const needle = query.trim().toLowerCase().replace(/^#/, "");
  return pullRequests.filter((pr) => {
    if (filter === "failing" && pr.stage !== "failing") return false;
    if (filter === "checking" && pr.stage !== "checking") return false;
    if (filter === "ready" && pr.stage !== "ready") return false;
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

function normalizeCheckRun(value: unknown): LiveCenterCheckRun {
  const run = asRecord(value);
  return {
    name: firstText(run, ["name", "context"]) || "Unnamed check",
    kind: asText(run.kind) || "check",
    status: asText(run.status),
    conclusion: asText(run.conclusion),
    required: typeof run.required === "boolean" ? run.required : null,
    durationMs: asNumber(run.durationMs),
    startedAt: asText(run.startedAt),
    completedAt: asText(run.completedAt),
  };
}

function normalizeReview(value: unknown, requestedReviewers: string[]): LiveCenterReview {
  const review = asRecord(value);
  const state = asText(review.state);
  return {
    state:
      state === "approved" || state === "changes_requested" || state === "review_required"
        ? state
        : "none",
    approvals: asArray(review.approvals).map((name) => asText(name)).filter(Boolean),
    changesRequestedBy: asArray(review.changesRequestedBy)
      .map((name) => asText(name))
      .filter(Boolean),
    requestedReviewers:
      asArray(review.requestedReviewers).map((name) => asText(name)).filter(Boolean).length > 0
        ? asArray(review.requestedReviewers).map((name) => asText(name)).filter(Boolean)
        : requestedReviewers,
  };
}

function normalizeGate(value: unknown): LiveCenterGate {
  const gate = asRecord(value);
  const state = asText(gate.state);
  return {
    state:
      state === "passed" || state === "failing" || state === "pending" || state === "missing"
        ? state
        : "unknown",
    checks: asArray(gate.checks).map((name) => asText(name)).filter(Boolean),
  };
}

const SERVER_STAGES: LiveCenterStage[] = ["queue", "checking", "failing", "ready"];

// The server stage (payload v2) is computed from the corrected Ready
// definition — gate registered green, battery terminal, base the
// default branch — and always wins when present. Older payloads fall
// back to the local derivation from the check summary.
function resolveStage(
  entry: Record<string, unknown>,
  input: { draft: boolean; total: number; passed: number; failed: number; pending: number },
): LiveCenterStage {
  const serverStage = asText(entry.stage) as LiveCenterStage;
  if (SERVER_STAGES.includes(serverStage)) return serverStage;
  return stageForPullRequest(input);
}

// Runner truth from the runs themselves (current-permissions data):
// a job GitHub shows in progress WITH a runner name is a busy runner;
// a queued job is waiting for one. There is no fleet list behind
// this — a runner that is idle and unassigned is not visible here,
// and the page says so rather than guessing.
export function deriveRunnerView(runs: LiveCenterRun[]): LiveCenterRunnerView {
  const busy: LiveCenterRunnerView["busy"] = [];
  const queuedJobs: LiveCenterRunnerView["queuedJobs"] = [];
  let runningUnassigned = 0;
  for (const run of runs) {
    for (const job of run.jobs) {
      if (job.rawStatus === "in_progress") {
        if (job.runnerName) {
          busy.push({ name: job.runnerName, jobName: job.name, workflowName: run.workflowName });
        } else {
          runningUnassigned += 1;
        }
      } else if (job.rawStatus === "queued") {
        queuedJobs.push({ name: job.name, workflowName: run.workflowName });
      }
    }
  }
  return {
    busy,
    runningUnassigned,
    queuedJobs,
    busyCount: busy.length,
    waitingCount: queuedJobs.length,
  };
}

function normalizeHistory(raw: unknown): LiveCenterHistory {
  const history = asRecord(raw);
  const entry = (value: unknown): LiveCenterHistoryEntry => {
    const item = asRecord(value);
    return {
      number: asNumber(item.pr ?? item.number),
      title: asText(item.title),
      at: asText(item.at),
      queueTimeMs: asNumber(item.queueTimeMs),
      reason: asText(item.reason),
    };
  };
  const day = (value: unknown): LiveCenterHistoryDay => {
    const item = asRecord(value);
    const nullable = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      day: asText(item.day),
      entered: asCount(item.entered),
      merged: asCount(item.merged),
      removed: asCount(item.removed),
      mergedRatePct: nullable(item.mergedRatePct),
      queueTimeMedianMs: nullable(item.queueTimeMedianMs),
      openPrs: nullable(item.openPrs),
      failingPrs: nullable(item.failingPrs),
      checksPassed: nullable(item.checksPassed),
      checksFailed: nullable(item.checksFailed),
      checksPending: nullable(item.checksPending),
      runtimeMedianMs: nullable(item.runtimeMedianMs),
    };
  };
  const period = asRecord(history.period);
  return {
    merged: asArray(history.merged).map(entry),
    removed: asArray(history.removed).map(entry),
    daily: asArray(history.daily).map(day),
    period: {
      days: asCount(period.days),
      entered: asCount(period.entered),
      merged: asCount(period.merged),
      removed: asCount(period.removed),
    },
  };
}

// The Inbox groups, in the order the page shows them: what a person
// can actually act on first. Every group's description says, in plain
// words, what the state means and what happens next — the items
// themselves carry only the specific fact for that pull request.
function buildInboxGroups(
  pullRequests: LiveCenterPullRequest[],
  deploymentActions: { waitingOn: string; runId: number | null }[],
): LiveCenterInboxGroup[] {
  const itemFor = (pr: LiveCenterPullRequest, blocker: string): LiveCenterInboxItem => ({
    number: pr.number,
    title: pr.title,
    blocker,
    passed: pr.passed,
    total: pr.total,
    updatedAt: pr.updatedAt,
    runId: null,
  });
  const groups: LiveCenterInboxGroup[] = [];
  const drafts = pullRequests.filter((pr) => pr.draft);
  if (drafts.length > 0) {
    groups.push({
      key: "draft",
      label: "Draft — mark ready?",
      description:
        "Only the author can mark a draft ready for review. Until they do, the pull request stays out of the merge queue.",
      items: drafts.map((pr) => itemFor(pr, "Still a draft — waiting on the author to mark it ready for review")),
    });
  }
  const failing = pullRequests.filter((pr) => pr.failed > 0);
  if (failing.length > 0) {
    groups.push({
      key: "failing",
      label: "Checks failing",
      description:
        "These pull requests have checks that failed. The author pushes a fix and the checks run again on the new commit — there is nothing for you to approve here.",
      items: failing.map((pr) =>
        itemFor(pr, pr.failing.length > 0 ? `Failing checks: ${pr.failing.join(", ")}` : "Checks failed"),
      ),
    });
  }
  const conflicts = pullRequests.filter((pr) => pr.mergeableState === "dirty");
  if (conflicts.length > 0) {
    groups.push({
      key: "conflicts",
      label: "Merge conflicts",
      description:
        "The branch and the base branch changed the same lines. The author has to resolve the conflict before this can merge.",
      items: conflicts.map((pr) => itemFor(pr, "Merge conflicts with the base branch")),
    });
  }
  const behind = pullRequests.filter((pr) => pr.mergeableState === "behind");
  if (behind.length > 0) {
    groups.push({
      key: "behind",
      label: "Branch behind",
      description:
        "The base branch moved ahead. Updating the branch brings in the newest base and re-runs the checks.",
      items: behind.map((pr) => itemFor(pr, "Branch is behind the base branch")),
    });
  }
  const review = pullRequests.filter((pr) => pr.review.state === "review_required");
  if (review.length > 0) {
    groups.push({
      key: "review",
      label: "Waiting for review",
      description:
        "A reviewer was asked to look at these. When they approve — or ask for changes — the pull request moves on by itself.",
      items: review.map((pr) =>
        itemFor(
          pr,
          pr.review.requestedReviewers.length > 0
            ? `Review requested from ${pr.review.requestedReviewers.join(", ")}`
            : "Waiting for a reviewer",
        ),
      ),
    });
  }
  const gateMissing = pullRequests.filter(
    (pr) => pr.gate.state === "missing" && pr.failed === 0 && pr.pending === 0,
  );
  if (gateMissing.length > 0) {
    groups.push({
      key: "gate",
      label: "Required gate has not reported",
      description:
        "The one check that must pass before merging has not reported on the newest commit yet. This is a wait, not a failure — and a pull request in this state is never counted as ready.",
      items: gateMissing.map((pr) =>
        itemFor(
          pr,
          pr.gate.checks.length > 0
            ? `Waiting on ${pr.gate.checks.join(", ")} to report on the newest commit`
            : "Waiting on the required gate to report on the newest commit",
        ),
      ),
    });
  }
  if (deploymentActions.length > 0) {
    groups.push({
      key: "deployment",
      label: "Deployment approvals",
      description:
        "A finished workflow run is waiting for a person to approve the deployment. Opening the run on GitHub is where the approval happens.",
      items: deploymentActions.map((action) => ({
        number: null,
        title: "",
        blocker: action.waitingOn,
        passed: 0,
        total: 0,
        updatedAt: "",
        runId: action.runId,
      })),
    });
  }
  return groups;
}

export function normalizeLiveCenterBoard(raw: unknown): LiveCenterBoardView {
  const board = asRecord(raw);
  const checksByNumber = asRecord(board.checks);
  const checkDetailsByNumber = asRecord(board.checkDetails);
  const rawBatch = asRecord(board.batches ?? board.batch);
  const defaultBranch = asText(rawBatch.baseRef ?? rawBatch.base_ref);

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
    const baseRef = firstText(entry, ["baseRef", "base_ref"]) || asText(asRecord(entry.base).ref);
    const requestedReviewers = [
      ...asArray(entry.requestedReviewers).map((name) => asText(name)).filter(Boolean),
    ];
    const detail =
      number !== null ? asRecord(checkDetailsByNumber[String(number)]) : asRecord(null);
    return {
      number,
      title: firstText(entry, ["title"]) || asText(pr.title),
      author: authorOf(entry) || authorOf(pr),
      draft,
      position: asNumber(entry.position) ?? index + 1,
      mergeableState: firstText(entry, ["mergeableState", "state", "status"]),
      mergeable: typeof entry.mergeable === "boolean" ? entry.mergeable : null,
      headSha: firstText(entry, ["headSha", "head_sha"]),
      headRef: firstText(entry, ["headRef", "head_ref"]),
      baseRef,
      createdAt: firstText(entry, ["createdAt", "created_at"]),
      updatedAt: firstText(entry, ["updatedAt", "updated_at"]),
      labels: asArray(entry.labels).map((name) => asText(name)).filter(Boolean),
      comments: asCount(entry.comments),
      isStackChild: Boolean(baseRef && defaultBranch && baseRef !== defaultBranch),
      total,
      ...summary,
      checkRuns: asArray(detail.runs).map(normalizeCheckRun),
      review: normalizeReview(entry.review, requestedReviewers),
      gate: normalizeGate(entry.gate),
      stage: resolveStage(entry, { draft, total, ...summary }),
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
      const baseRef = firstText(pr, ["baseRef", "base_ref"]);
      pullRequests.push({
        number,
        title: asText(pr.title),
        author: authorOf(pr),
        draft: pr.draft === true,
        position: index + 1,
        mergeableState: firstText(pr, ["mergeableState", "state", "status"]),
        mergeable: typeof pr.mergeable === "boolean" ? pr.mergeable : null,
        headSha: firstText(pr, ["headSha", "head_sha"]),
        headRef: firstText(pr, ["headRef", "head_ref"]),
        baseRef,
        createdAt: firstText(pr, ["createdAt", "created_at"]),
        updatedAt: firstText(pr, ["updatedAt", "updated_at"]),
        labels: asArray(pr.labels).map((name) => asText(name)).filter(Boolean),
        comments: asCount(pr.comments),
        isStackChild: Boolean(baseRef && defaultBranch && baseRef !== defaultBranch),
        total,
        ...summary,
        checkRuns: [],
        review: normalizeReview(pr.review, []),
        gate: normalizeGate(pr.gate),
        stage: resolveStage(pr, { draft: pr.draft === true, total, ...summary }),
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
    stage: pr.stage,
    baseRef: pr.baseRef,
    headRef: pr.headRef,
  }));

  const runs: LiveCenterRun[] = asArray(board.activity ?? board.runs).map((item) => {
    const run = asRecord(item);
    return {
      runId: asNumber(run.runId ?? run.id),
      workflowName: firstText(run, ["workflowName", "name"]) || "Workflow run",
      status: activityStatusLabel(run.status ?? run.state, run.conclusion),
      rawStatus: asText(run.status ?? run.state),
      conclusion: asText(run.conclusion),
      headSha: firstText(run, ["headSha", "head_sha"]),
      headBranch: firstText(run, ["headBranch", "head_branch"]),
      event: asText(run.event),
      createdAt: firstText(run, ["createdAt", "created_at"]),
      updatedAt: firstText(run, ["updatedAt", "updated_at"]),
      pullRequestNumbers: asArray(run.pullRequestNumbers)
        .map((value) => asNumber(value))
        .filter((value): value is number => value !== null),
      jobs: asArray(run.jobs).map((jobItem) => {
        const job = asRecord(jobItem);
        return {
          id: asNumber(job.id),
          name: firstText(job, ["name", "jobName"]) || "Job",
          status: activityStatusLabel(job.status ?? job.state, job.conclusion),
          rawStatus: asText(job.status ?? job.state),
          conclusion: asText(job.conclusion),
          runnerName: firstText(job, ["runnerName", "runner_name", "runner"]),
          labels: asArray(job.labels).map((name) => asText(name)).filter(Boolean),
          startedAt: firstText(job, ["startedAt", "started_at"]),
          completedAt: firstText(job, ["completedAt", "completed_at"]),
        };
      }),
    };
  });
  const runners = deriveRunnerView(runs);

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
    inQueuePrs: pullRequests.filter((pr) => pr.stage === "queue").length,
    waitingOnOwner: ownerActions.length,
    waitingOnYou: ownerPrNumbers.size,
  };

  const deploymentActions = rawActions
    .map((item) => asRecord(item))
    .filter((action) => asText(action.type) === "deployment_approval")
    .map((action) => ({
      waitingOn: firstText(action, ["waitingOn", "waiting_on", "description", "reason"]),
      runId: asNumber(action.runId ?? action.run_id),
    }));
  const inboxGroups = buildInboxGroups(pullRequests, deploymentActions);

  const rawPagination = asRecord(board.pagination);
  const pagination: LiveCenterPagination = {
    total: asCount(rawPagination.total) || pullRequests.length,
    page: asCount(rawPagination.page) || 1,
    perPage: asCount(rawPagination.perPage) || pullRequests.length || LIVE_CENTER_PAGE_SIZE,
    pages: asCount(rawPagination.pages) || 1,
  };

  return {
    repoLabel: firstText(board, ["repo", "repository", "repoFullName"]),
    generatedAt: asText(board.generatedAt),
    defaultBranch,
    stats,
    queue,
    pullRequests,
    activity,
    runs,
    runners,
    ownerActions,
    ownerActionGroups,
    inboxGroups,
    history: normalizeHistory(board.history),
    pagination,
    batch,
  };
}

// ---------------------------------------------------------------------
// Runner minutes — the runners-ledger seam.
//
// The minutes themselves live in the separate runners service
// (balances, cache-GB accounting, spot/on-demand lane splits). That
// service is not deployed yet, so the api-access proxy answers the
// minutes read with `{ configured: false }` and the page renders the
// honest not-configured state. When the service lands, the proxy
// returns its account summary in the shape normalized below — the
// page does not change. The seam NEVER invents a balance: a field
// the service does not send stays null and renders as an em dash or
// an explanatory line, never as a made-up number.

export const LIVE_CENTER_MINUTES_BUY_PATH = "/account/runner-minutes-checkout/";

export type LiveCenterMinutesBalance = {
  kind: string;
  label: string;
  minutesLeft: number | null;
  packMinutes: number | null;
  rateText: string;
  lowBalance: boolean;
  note: string;
};

export type LiveCenterMinutesView = {
  configured: boolean;
  balances: LiveCenterMinutesBalance[];
  cache: { gbStored: number | null; monthCostText: string; note: string } | null;
  lanes: {
    windowLabel: string;
    spotMinutes: number | null;
    onDemandMinutes: number | null;
    creditsDrawn: number | null;
  } | null;
  byRepository: { repo: string; minutes: number | null; jobs: number | null }[];
  recentJobs: {
    name: string;
    repo: string;
    machine: string;
    lane: string;
    durationText: string;
    creditsDrawn: number | null;
  }[];
  recommendation: { text: string; actionLabel: string } | null;
  buyPath: string;
};

export function normalizeLiveCenterMinutes(raw: unknown): LiveCenterMinutesView {
  const root = asRecord(raw);
  const configured = root.configured === true;
  const nullable = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const cacheRaw = asRecord(root.cache);
  const lanesRaw = asRecord(root.lanes);
  const recommendationRaw = asRecord(root.recommendation);
  return {
    configured,
    balances: configured
      ? asArray(root.balances).map((item) => {
          const balance = asRecord(item);
          return {
            kind: asText(balance.kind),
            label: asText(balance.label),
            minutesLeft: nullable(balance.minutesLeft),
            packMinutes: nullable(balance.packMinutes),
            rateText: asText(balance.rateText),
            lowBalance: balance.lowBalance === true,
            note: asText(balance.note),
          };
        })
      : [],
    cache:
      configured && Object.keys(cacheRaw).length > 0
        ? {
            gbStored: nullable(cacheRaw.gbStored),
            monthCostText: asText(cacheRaw.monthCostText),
            note: asText(cacheRaw.note),
          }
        : null,
    lanes:
      configured && Object.keys(lanesRaw).length > 0
        ? {
            windowLabel: asText(lanesRaw.windowLabel),
            spotMinutes: nullable(lanesRaw.spotMinutes),
            onDemandMinutes: nullable(lanesRaw.onDemandMinutes),
            creditsDrawn: nullable(lanesRaw.creditsDrawn),
          }
        : null,
    byRepository: configured
      ? asArray(root.byRepository).map((item) => {
          const row = asRecord(item);
          return {
            repo: asText(row.repo),
            minutes: nullable(row.minutes),
            jobs: nullable(row.jobs),
          };
        })
      : [],
    recentJobs: configured
      ? asArray(root.recentJobs).map((item) => {
          const job = asRecord(item);
          return {
            name: asText(job.name),
            repo: asText(job.repo),
            machine: asText(job.machine),
            lane: asText(job.lane),
            durationText: asText(job.durationText),
            creditsDrawn: nullable(job.creditsDrawn),
          };
        })
      : [],
    recommendation:
      configured && asText(recommendationRaw.text)
        ? {
            text: asText(recommendationRaw.text),
            actionLabel: asText(recommendationRaw.actionLabel) || "See your options",
          }
        : null,
    buyPath: asText(root.buyPath) || LIVE_CENTER_MINUTES_BUY_PATH,
  };
}
