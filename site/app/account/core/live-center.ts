// Data-shaping helpers for the Live Center board. The board JSON comes
// from the Merge Governance pilot through the api-access proxy unchanged;
// these helpers normalize it defensively into exactly what the page
// renders, so a missing or partial section degrades to an empty state
// instead of breaking the whole board.

export type LiveCenterQueueEntry = {
  number: number | null;
  title: string;
  position: number;
  state: string;
};

export type LiveCenterPullRequest = {
  number: number | null;
  title: string;
  passed: number;
  failed: number;
  pending: number;
  failing: string[];
};

export type LiveCenterJob = {
  name: string;
  runnerName: string;
  status: string;
};

export type LiveCenterOwnerAction = {
  label: string;
  waitingOn: string;
};

export type LiveCenterBoardView = {
  repoLabel: string;
  queue: LiveCenterQueueEntry[];
  pullRequests: LiveCenterPullRequest[];
  jobs: LiveCenterJob[];
  ownerActions: LiveCenterOwnerAction[];
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

export function normalizeLiveCenterBoard(raw: unknown): LiveCenterBoardView {
  const board = asRecord(raw);

  const queue = asArray(board.queue ?? board.mergeQueue).map((item, index) => {
    const entry = asRecord(item);
    const pr = asRecord(entry.pullRequest);
    return {
      number: asNumber(entry.number ?? entry.prNumber ?? pr.number),
      title: firstText(entry, ["title"]) || asText(pr.title),
      position: asNumber(entry.position) ?? index + 1,
      state: firstText(entry, ["state", "status"]),
    };
  });

  const pullRequests = asArray(board.pullRequests ?? board.pull_requests).map((item) => {
    const pr = asRecord(item);
    const summary = summarizeChecks(pr.checks ?? pr.checkRuns);
    return {
      number: asNumber(pr.number ?? pr.prNumber),
      title: asText(pr.title),
      ...summary,
    };
  });

  const jobs = asArray(board.jobs ?? board.runners ?? board.runnersAtWork).map((item) => {
    const job = asRecord(item);
    return {
      name: firstText(job, ["name", "jobName", "workflowName"]) || "Job",
      runnerName: firstText(job, ["runner_name", "runnerName", "runner"]),
      status: firstText(job, ["status", "state"]),
    };
  });

  const ownerActions = asArray(board.ownerActions ?? board.owner_actions).map((item) => {
    const action = asRecord(item);
    const number = asNumber(action.number ?? action.prNumber);
    const title = asText(action.title);
    const label = number !== null ? `#${number}${title ? ` ${title}` : ""}` : title;
    return {
      label,
      waitingOn: firstText(action, ["waitingOn", "waiting_on", "description", "reason"]),
    };
  });

  return {
    repoLabel: firstText(board, ["repo", "repository", "repoFullName"]),
    queue,
    pullRequests,
    jobs,
    ownerActions,
  };
}
