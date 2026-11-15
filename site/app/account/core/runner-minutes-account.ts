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
