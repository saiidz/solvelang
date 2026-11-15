import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNNER_MINUTES_PAUSED_LINE,
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
