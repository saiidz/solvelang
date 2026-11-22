import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNNER_MINUTES_APPROVE_LINE,
  RUNNER_MINUTES_DECLINE_LINE,
  RUNNER_MINUTES_PAUSED_LINE,
  RUNNER_MINUTES_START_MODE_PATH,
  runnerMinutesApprovalPath,
  runnerMinutesPendingApprovals,
  runnerMinutesPoolLabel,
  runnerMinutesQueuedLabel,
  runnerMinutesStartMode,
  runnerMinutesStartModeLabel,
  runnerMinutesStatus,
  runnerMinutesToggleLabel,
  runnerMinutesTogglePath,
} from "./runner-minutes-account";

// The start/pause contract is shared by the checkout page's control
// (its first consumer) and the account home's Runner minutes card.
// These tests pin the semantics both surfaces render by, so the two
// can never drift onto different endpoints or status readings.

test("a paused account view reads as paused", () => {
  assert.equal(runnerMinutesStatus({ status: "paused" }), "paused");
});

test("an active account view reads as active", () => {
  assert.equal(runnerMinutesStatus({ status: "active" }), "active");
});

test("a missing status field reads as active, never paused", () => {
  // An older runners service does not send the field at all; absence
  // must never render a customer as paused.
  assert.equal(runnerMinutesStatus({}), "active");
  assert.equal(runnerMinutesStatus({ status: undefined }), "active");
});

test("the toggle posts to the pause endpoint while active", () => {
  assert.equal(runnerMinutesTogglePath("active"), "/customer/runner-minutes/pause");
});

test("the toggle posts to the resume endpoint while paused", () => {
  assert.equal(runnerMinutesTogglePath("paused"), "/customer/runner-minutes/resume");
});

test("the toggle offers Pause while active and Start while paused", () => {
  assert.equal(runnerMinutesToggleLabel("active"), "Pause minutes");
  assert.equal(runnerMinutesToggleLabel("paused"), "Start minutes");
});

test("the paused line is the plain-language sentence, verbatim", () => {
  assert.equal(
    RUNNER_MINUTES_PAUSED_LINE,
    "Your minutes are paused — jobs will not run and no minutes will be used.",
  );
});

// ---------------------------------------------------------------------------
// Start mode — the per-account choice between auto-start and
// approve-each-run, and the pending approvals the card renders.
// These pin the semantics the account home's card renders by, on
// the same shared helpers the start/pause contract uses.

test("an approve account view reads as approve mode", () => {
  assert.equal(runnerMinutesStartMode({ startMode: "approve" }), "approve");
});

test("an auto account view reads as auto mode", () => {
  assert.equal(runnerMinutesStartMode({ startMode: "auto" }), "auto");
});

test("a missing startMode field reads as auto, never approve", () => {
  // An older runners service does not send the field at all; absence
  // must never render a customer as needing approvals.
  assert.equal(runnerMinutesStartMode({}), "auto");
  assert.equal(runnerMinutesStartMode({ startMode: undefined }), "auto");
});

test("the start mode is set through the start-mode route", () => {
  assert.equal(RUNNER_MINUTES_START_MODE_PATH, "/customer/runner-minutes/start-mode");
});

test("the mode labels name the two choices plainly", () => {
  assert.equal(runnerMinutesStartModeLabel("auto"), "Auto-start");
  assert.equal(runnerMinutesStartModeLabel("approve"), "Approve each run");
});

test("the approve-mode line is the plain-language sentence, verbatim", () => {
  assert.equal(
    RUNNER_MINUTES_APPROVE_LINE,
    "Jobs wait for your approval before they run. Nothing is provisioned — and nothing is billed — until you approve.",
  );
});

test("the decline line is the honest sentence, verbatim", () => {
  // Declining cannot cancel the customer's GitHub job — the app
  // has no permission to — and the copy says so plainly.
  assert.equal(
    RUNNER_MINUTES_DECLINE_LINE,
    "Declining means we won't run it — the job stays queued in GitHub until you cancel it there",
  );
});

test("pending approvals read from the account view, missing means none", () => {
  assert.deepEqual(runnerMinutesPendingApprovals({}), []);
  assert.deepEqual(runnerMinutesPendingApprovals({ pendingApprovals: undefined }), []);
  const approval = {
    id: "appr-1",
    jobId: "4242",
    runId: 9001,
    repo: "saiidz/some-repo",
    workflowName: "CI",
    jobName: "test",
    pool: "standard",
    status: "pending",
    queuedAt: "2026-11-22T11:59:00.000Z",
    createdAt: "2026-11-22T12:00:00.000Z",
  };
  assert.deepEqual(runnerMinutesPendingApprovals({ pendingApprovals: [approval] }), [approval]);
});

test("a decision posts to that approval's own approve or decline route", () => {
  assert.equal(runnerMinutesApprovalPath("appr-1", "approve"), "/customer/runner-minutes/approvals/appr-1/approve");
  assert.equal(runnerMinutesApprovalPath("appr-1", "decline"), "/customer/runner-minutes/approvals/appr-1/decline");
  assert.equal(
    runnerMinutesApprovalPath("appr/with space", "approve"),
    "/customer/runner-minutes/approvals/appr%2Fwith%20space/approve",
  );
});

test("pool labels name the pools as customers know them", () => {
  assert.equal(runnerMinutesPoolLabel("high-power"), "High-Power");
  assert.equal(runnerMinutesPoolLabel("standard"), "Standard");
});

test("the queued label renders a fixed UTC reading and never hides a bad value", () => {
  assert.equal(runnerMinutesQueuedLabel(null), "Queued time not reported");
  assert.equal(runnerMinutesQueuedLabel("2026-11-22T11:59:00.000Z"), "Sun, 22 Nov 2026 11:59:00 UTC");
  assert.equal(runnerMinutesQueuedLabel("not-a-date"), "not-a-date");
});
