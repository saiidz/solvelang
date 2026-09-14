import assert from "node:assert/strict";
import test from "node:test";
import { createSupportAutomationService } from "../src/support-automation.js";
import { createMemorySupportAutomationStore } from "../src/support-automation-store.js";

const ACCOUNT_ID = `acct_${"c".repeat(32)}`;
const session = { accountId: ACCOUNT_ID, email: "owner@example.test" };
const gmailSecret = `arn:aws:secretsmanager:us-east-1:123456789012:secret:solvelang/support-automation/${ACCOUNT_ID}/gmail-AbCd`;
const linearSecret = `arn:aws:secretsmanager:us-east-1:123456789012:secret:solvelang/support-automation/${ACCOUNT_ID}/linear-EfGh`;
const config = {
  provider: "gmail",
  inboxEmail: "support@example.test",
  gmailCredentialSecretArn: gmailSecret,
  taskProvider: "linear",
  linearCredentialSecretArn: linearSecret,
  linearTeamId: "team_test",
  policyVersion: "support-v1",
  allowedActions: ["create_linear_issue", "send_reply"],
};

async function runSensitive(text) {
  const store = createMemorySupportAutomationStore();
  const calls = { issue: 0, reply: 0 };
  const message = {
    id: `msg_${text.split(/[:=]/, 1)[0].replace(/[^a-z_]/gi, "_")}`,
    threadId: "thread_sensitive",
    rfcMessageId: "<sensitive@example.test>",
    from: "customer@example.test",
    to: config.inboxEmail,
    subject: "Account access question",
    text,
  };
  const gmail = {
    async getProfile() { return { emailAddress: config.inboxEmail }; },
    async listUnread() { return [{ id: message.id }]; },
    async getMessage() { return structuredClone(message); },
    async markRead() { return { id: message.id }; },
    async sendReply() { calls.reply += 1; return { id: "unexpected-reply" }; },
  };
  const linear = { async createIssue() { calls.issue += 1; return { id: "unexpected-issue" }; } };
  let clock = Date.parse("2026-09-14T01:30:00Z");
  const service = createSupportAutomationService({ store, gmail, linear, activationEnabled: true, now: () => ++clock, idFactory: (() => { let n = 0; return () => `claim_${++n}`; })(), logger: { error() {} } });
  await service.configure(session, config);
  await service.resume(session);
  const result = await service.processTick();
  return { service, calls, result };
}

for (const [label, text] of [
  ["password", "password: synthetic-password-value"],
  ["passcode", "passcode=123456"],
  ["api key", "api_key: synthetic-api-key-value"],
  ["secret", "secret = synthetic-secret-value"],
]) {
  test(`${label} phrases are classified before redaction and cannot authorize an external action`, async () => {
    const { service, calls, result } = await runSensitive(text);
    assert.equal(result.accounts[0].processed[0].state, "REVIEW_REQUIRED");
    assert.equal(calls.issue, 0);
    assert.equal(calls.reply, 0);
    const history = await service.history(session);
    assert.equal(history.length, 1);
    assert.equal(history[0].requiresReview, true);
    assert.ok(history[0].sensitiveReasons.includes("account_security"));
  });
}
