import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RUNNER_MINUTES_DECLINE_LINE,
  runnerMinutesApprovalPath,
  runnerMinutesPendingApprovals,
  runnerMinutesQueuedLabel,
  runnerMinutesStartMode,
  type RunnerMinutesStartMode,
} from "./runner-minutes-account";

// QA pins for the start mode card (root: the start-mode helpers in
// runner-minutes-account and the account home's Runner minutes
// card). These pin the wiring AROUND the root build:
//
//   1. The card drives the mode and the decisions through the
//      shared helpers and routes — never a hand-typed endpoint.
//   2. The pending approvals list renders only in approve mode,
//      and the honest decline sentence comes from the shared
//      constant, verbatim.
//   3. Every write is followed by a re-read of the account view
//      (the start/pause pattern): no blind local flips.
//   4. Helper edges the root tests do not cover: an unrecognized
//      mode value from a future service still reads as auto, and
//      a malformed pendingApprovals payload reads as none.

const accountHome = readFileSync("app/account/home/AccountHome.tsx", "utf8");

test("the card sets the mode through the shared start-mode route constant", () => {
  assert.ok(accountHome.includes("RUNNER_MINUTES_START_MODE_PATH"), "the card imports the shared route");
  assert.ok(accountHome.includes("chooseStartMode"), "the card has a mode chooser");
  assert.ok(accountHome.includes("body: JSON.stringify({ startMode: mode })"), "the chooser posts the chosen mode");
});

test("the card decides through the shared per-approval route builder", () => {
  assert.ok(accountHome.includes("runnerMinutesApprovalPath(approvalId, decision)"));
  assert.ok(!accountHome.includes("/customer/runner-minutes/approvals/"), "no hand-typed approvals endpoint in the card");
});

test("the approvals list is gated on approve mode in the card source", () => {
  assert.ok(
    accountHome.includes('minutesStartMode === "approve" && pendingApprovals.length > 0'),
    "the list renders only in approve mode with approvals waiting",
  );
  assert.ok(accountHome.includes("Waiting for your approval"), "the list is headed plainly");
});

test("the decline sentence reaches the card from the shared constant, verbatim", () => {
  assert.ok(accountHome.includes("{RUNNER_MINUTES_DECLINE_LINE}"), "the card renders the shared constant");
  assert.equal(
    RUNNER_MINUTES_DECLINE_LINE,
    "Declining means we won't run it — the job stays queued in GitHub until you cancel it there",
  );
});

test("mode changes and decisions re-read the account before rendering", () => {
  const choose = accountHome.indexOf("async function chooseStartMode");
  const decide = accountHome.indexOf("async function decideApproval");
  assert.ok(choose >= 0 && decide > choose, "both actions exist");
  assert.ok(accountHome.slice(choose, decide).includes("await rereadMinutes()"), "the mode change re-reads");
  assert.ok(accountHome.slice(decide).includes("await rereadMinutes()"), "the decision re-reads");
});

test("an unrecognized mode value from a future service still reads as auto", () => {
  const future = { startMode: "sometimes" as RunnerMinutesStartMode };
  assert.equal(runnerMinutesStartMode(future), "auto");
});

test("a malformed pendingApprovals payload reads as no approvals", () => {
  assert.deepEqual(runnerMinutesPendingApprovals({ pendingApprovals: "none" as never }), []);
  assert.deepEqual(runnerMinutesPendingApprovals({ pendingApprovals: null as never }), []);
});

test("approval routes encode unusual ids and queued labels survive offsets", () => {
  assert.equal(
    runnerMinutesApprovalPath("a b#c", "decline"),
    "/customer/runner-minutes/approvals/a%20b%23c/decline",
  );
  assert.equal(runnerMinutesQueuedLabel("2026-11-22T13:59:00.000+02:00"), "Sun, 22 Nov 2026 11:59:00 UTC");
});
