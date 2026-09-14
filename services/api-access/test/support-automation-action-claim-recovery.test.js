import assert from "node:assert/strict";
import test from "node:test";
import { createSupportAutomationService } from "../src/support-automation.js";

const ACCOUNT_ID = `acct_${"d".repeat(32)}`;
const config = {
  accountId: ACCOUNT_ID,
  recordType: "CONFIG",
  provider: "gmail",
  inboxEmail: "support@example.test",
  gmailCredentialSecretArn: `arn:aws:secretsmanager:us-east-1:123456789012:secret:solvelang/support-automation/${ACCOUNT_ID}/gmail-AbCd`,
  taskProvider: "linear",
  linearCredentialSecretArn: `arn:aws:secretsmanager:us-east-1:123456789012:secret:solvelang/support-automation/${ACCOUNT_ID}/linear-EfGh`,
  linearTeamId: "team_test",
  policyVersion: "support-v1",
  allowedActions: ["create_linear_issue"],
  automationState: "ACTIVE",
  revision: 7,
  createdAt: "2026-09-14T02:00:00.000Z",
  updatedAt: "2026-09-14T02:00:00.000Z",
};
const message = { id: "claim-recovery", threadId: "thread", rfcMessageId: "<claim-recovery@example.test>", from: "customer@example.test", to: config.inboxEmail, subject: "Setup question", text: "Please help with onboarding." };

function fixture(actionClaim) {
  const calls = { execute: 0, finishAction: 0, finishEvent: 0 };
  const store = {
    async getConfig() { return structuredClone(config); },
    async claimEvent(record) { return { created: true, record: { ...record, state: "PROCESSING" } }; },
    async finishEvent(input) { calls.finishEvent += 1; calls.event = input; },
    async claimAction() { return structuredClone(actionClaim); },
    async finishAction(input) { calls.finishAction += 1; calls.action = input; },
  };
  const linear = { async createIssue() { calls.execute += 1; return { id: "LIN-1", url: "https://linear.test/LIN-1" }; } };
  const gmail = { async sendReply() { throw new Error("not expected"); } };
  let n = 0;
  const service = createSupportAutomationService({ store, gmail, linear, activationEnabled: true, now: () => Date.parse("2026-09-14T02:30:00.000Z") + n++, idFactory: () => `claim_${++n}`, logger: { error() {} } });
  return { service, calls };
}

for (const [status, expectedState] of [["stopped", "STOPPED"], ["started", "OUTCOME_UNKNOWN"], ["unknown", "OUTCOME_UNKNOWN"], ["unexpected", "OUTCOME_UNKNOWN"]]) {
  test(`existing ${status} action claim never executes provider work`, async () => {
    const { service, calls } = fixture({ status });
    const result = await service.processMessage(config, message);
    assert.equal(result.state, expectedState);
    assert.equal(calls.execute, 0);
    assert.equal(calls.finishAction, 0, "a worker that did not acquire the claim must not rewrite it");
    assert.equal(calls.finishEvent, 1);
  });
}

test("a newly acquired action claim still executes and records success", async () => {
  const { service, calls } = fixture({ status: "claimed", claimId: "fresh" });
  const result = await service.processMessage(config, message);
  assert.equal(result.state, "PROCESSED");
  assert.equal(calls.execute, 1);
  assert.equal(calls.finishAction, 1);
  assert.equal(calls.action.status, "succeeded");
});
