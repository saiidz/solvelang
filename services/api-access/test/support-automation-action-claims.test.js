import assert from "node:assert/strict";
import test from "node:test";
import { createSupportAutomationService } from "../src/support-automation.js";

const ACCOUNT_ID = `acct_${"a".repeat(32)}`;
const config = {
  accountId: ACCOUNT_ID,
  recordType: "CONFIG",
  provider: "gmail",
  inboxEmail: "support@example.test",
  gmailCredentialSecretArn: `arn:aws:secretsmanager:us-east-1:123456789012:secret:solvelang/support-automation/${ACCOUNT_ID}/gmail-test-AbCd`,
  taskProvider: "linear",
  linearCredentialSecretArn: `arn:aws:secretsmanager:us-east-1:123456789012:secret:solvelang/support-automation/${ACCOUNT_ID}/linear-test-EfGh`,
  linearTeamId: "team_test",
  policyVersion: "support-v1",
  allowedActions: ["create_linear_issue"],
  automationState: "ACTIVE",
  revision: 7,
};
const message = { id: "msg_action_claim", from: "customer@example.test", subject: "Setup question", text: "How do I get started?" };

function fixture(actionStatus) {
  const calls = { issue: 0, finishAction: 0 };
  let finishedEvent;
  const store = {
    async claimEvent(record) { return { created: true, record: { ...record, state: "PROCESSING" } }; },
    async finishEvent(record) { finishedEvent = record; },
    async claimAction() { return actionStatus === "succeeded" ? { status: actionStatus, outcome: { id: "prior" } } : { status: actionStatus }; },
    async finishAction() { calls.finishAction += 1; },
    async getConfig() { return structuredClone(config); },
  };
  const linear = { async createIssue() { calls.issue += 1; return { id: "new_issue" }; } };
  const service = createSupportAutomationService({ store, gmail: {}, linear, activationEnabled: true, now: () => Date.parse("2026-09-14T02:00:00Z"), idFactory: () => "claim", logger: { error() {} } });
  return { service, calls, finishedEvent: () => finishedEvent };
}

for (const status of ["stopped", "started", "unknown", "unexpected"]) {
  test(`persisted ${status} action is never executed without a newly acquired claim`, async () => {
    const f = fixture(status);
    const result = await f.service.processMessage(config, message);
    assert.equal(f.calls.issue, 0);
    assert.equal(f.calls.finishAction, 0);
    assert.equal(result.state, status === "stopped" ? "STOPPED" : "OUTCOME_UNKNOWN");
    assert.equal(f.finishedEvent().state, result.state);
  });
}

test("a newly claimed action still executes once and records success", async () => {
  const f = fixture("claimed");
  const result = await f.service.processMessage(config, message);
  assert.equal(f.calls.issue, 1);
  assert.equal(f.calls.finishAction, 1);
  assert.equal(result.state, "PROCESSED");
  assert.equal(f.finishedEvent().state, "PROCESSED");
});
