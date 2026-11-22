// Runner Minutes account state — the start/pause contract every
// surface shares when it reads the Runner Minutes account view.
//
// The runners service answers GET /customer/runner-minutes/account
// with the signed-in customer's account view, read with the same
// session-authenticated customer pattern as the purchase call. The
// status field arrived with the start/pause build: "paused" means
// jobs do not run and no minutes are used. An older service does not
// send the field at all — absence means active, never paused.
//
// Pausing and resuming are POSTs against the same service, gated by
// the account session's CSRF token like every customer write:
//   active -> POST /customer/runner-minutes/pause
//   paused -> POST /customer/runner-minutes/resume
// After a toggle the caller re-reads the account and renders the
// state the service reports — never a blind local flip.
//
// The checkout page's start/pause control was the first consumer;
// the account home's Runner minutes card folds the same control in
// through these helpers, so the two surfaces can never drift onto
// different endpoints or different status semantics.

export type RunnerMinutesStatus = "active" | "paused";

// The slice of the account view the start/pause contract reads. The
// service's payload carries more (balances, lanes, jobs); each
// surface types the rest of the view for itself.
export type RunnerMinutesAccountStatusView = {
  status?: RunnerMinutesStatus;
};

export function runnerMinutesStatus(account: RunnerMinutesAccountStatusView): RunnerMinutesStatus {
  return account.status === "paused" ? "paused" : "active";
}

export function runnerMinutesTogglePath(
  status: RunnerMinutesStatus,
): "/customer/runner-minutes/pause" | "/customer/runner-minutes/resume" {
  return status === "paused" ? "/customer/runner-minutes/resume" : "/customer/runner-minutes/pause";
}

export function runnerMinutesToggleLabel(status: RunnerMinutesStatus): "Start minutes" | "Pause minutes" {
  return status === "paused" ? "Start minutes" : "Pause minutes";
}

// The paused state carries this plain-language line verbatim on
// every surface that shows the control.
export const RUNNER_MINUTES_PAUSED_LINE =
  "Your minutes are paused — jobs will not run and no minutes will be used.";

// ---------------------------------------------------------------------------
// Start mode — the per-account choice between auto-start and
// approve-each-run.
//
// The account view carries `startMode`: "auto" (the default — jobs
// start as soon as they queue, exactly as they always have) or
// "approve" (each queued job waits for the customer's approval
// before anything is provisioned; nothing is billed for the wait,
// because billing runs from the job's GitHub start to its GitHub
// completion). An older service does not send the field at all —
// absence means auto, never approve.
//
// Setting the mode is a POST to the start-mode route with the
// session's CSRF token, like every customer write; the view also
// carries `pendingApprovals` — the jobs waiting for a decision,
// each decidable through its own approve/decline route. After every
// write the caller re-reads the account and renders the state the
// service reports — never a blind local flip.

export type RunnerMinutesStartMode = "auto" | "approve";

// The slice of the account view the start-mode contract reads.
export type RunnerMinutesAccountStartModeView = {
  startMode?: RunnerMinutesStartMode;
  pendingApprovals?: RunnerMinutesPendingApproval[];
};

export function runnerMinutesStartMode(
  account: RunnerMinutesAccountStartModeView,
): RunnerMinutesStartMode {
  return account.startMode === "approve" ? "approve" : "auto";
}

export const RUNNER_MINUTES_START_MODE_PATH = "/customer/runner-minutes/start-mode";

export function runnerMinutesStartModeLabel(mode: RunnerMinutesStartMode): "Auto-start" | "Approve each run" {
  return mode === "approve" ? "Approve each run" : "Auto-start";
}

// Shown under the control in approve mode: the plain-language
// statement of what waiting means.
export const RUNNER_MINUTES_APPROVE_LINE =
  "Jobs wait for your approval before they run. Nothing is provisioned — and nothing is billed — until you approve.";

// Shown with the pending approvals list, verbatim: the honest
// limit of declining. We cannot cancel the customer's GitHub job —
// the app has no permission to — so the copy says exactly that.
export const RUNNER_MINUTES_DECLINE_LINE =
  "Declining means we won't run it — the job stays queued in GitHub until you cancel it there";

// One job waiting for the customer's decision, in the shape the
// account view carries it.
export type RunnerMinutesPendingApproval = {
  id: string;
  jobId: string;
  runId: number | null;
  repo: string;
  workflowName: string | null;
  jobName: string | null;
  pool: string;
  status: string;
  queuedAt: string | null;
  createdAt: string;
};

export function runnerMinutesPendingApprovals(
  account: RunnerMinutesAccountStartModeView,
): RunnerMinutesPendingApproval[] {
  return Array.isArray(account.pendingApprovals) ? account.pendingApprovals : [];
}

export function runnerMinutesApprovalPath(
  approvalId: string,
  decision: "approve" | "decline",
): string {
  return `/customer/runner-minutes/approvals/${encodeURIComponent(approvalId)}/${decision}`;
}

export function runnerMinutesPoolLabel(pool: string): "High-Power" | "Standard" {
  return pool === "high-power" ? "High-Power" : "Standard";
}

// The queued time as the card shows it: a fixed UTC rendering, so
// every customer sees the same unambiguous clock reading. An
// unparseable value is shown as-is rather than hidden.
export function runnerMinutesQueuedLabel(queuedAt: string | null): string {
  if (!queuedAt) return "Queued time not reported";
  const parsed = new Date(queuedAt);
  if (Number.isNaN(parsed.getTime())) return queuedAt;
  return `${parsed.toUTCString().replace(" GMT", "")} UTC`;
}
