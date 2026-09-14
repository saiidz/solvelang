import assert from "node:assert/strict";
import test from "node:test";
import { createSupportAutomationService, supportAutomationInternals } from "../src/support-automation.js";
import { createMemorySupportAutomationStore } from "../src/support-automation-store.js";

const ACCOUNT_ID = `acct_${"a".repeat(32)}`;
const session = { accountId: ACCOUNT_ID, email: "owner@example.test" };
const config = {
  provider: "gmail",
  inboxEmail: "support@example.test",
  gmailCredentialSecretArn: `arn:aws:secretsmanager:us-east-1:123456789012:secret:solvelang/support-automation/${ACCOUNT_ID}/gmail-test-AbCd`,
  taskProvider: "linear",
  linearCredentialSecretArn: `arn:aws:secretsmanager:us-east-1:123456789012:secret:solvelang/support-automation/${ACCOUNT_ID}/linear-test-EfGh`,
  linearTeamId: "team_test",
  policyVersion: "support-v1",
  allowedActions: ["create_linear_issue", "send_reply"],
};

function fixture(text, id) {
  const store = createMemorySupportAutomationStore();
  const calls = { issue: 0, reply: 0, ack: 0 };
  const message = { id, threadId: `thread_${id}`, rfcMessageId: `<${id}@example.test>`, from: "customer@example.test", to: config.inboxEmail, subject: "Support request", text };
  const gmail = {
    async getProfile() { return { emailAddress: config.inboxEmail }; },
    async listUnread() { return [{ id }]; },
    async getMessage() { return structuredClone(message); },
    async markRead() { calls.ack += 1; return { id }; },
    async sendReply() { calls.reply += 1; return { id: "reply" }; },
  };
  const linear = { async createIssue() { calls.issue += 1; return { id: "issue" }; } };
  let clock = Date.parse("2026-09-14T02:00:00.000Z");
  const service = createSupportAutomationService({ store, gmail, linear, activationEnabled: true, now: () => ++clock, logger: { error() {} } });
  return { service, calls };
}

async function run(text, id) {
  const f = fixture(text, id);
  await f.service.configure(session, config);
  await f.service.resume(session);
  const result = await f.service.processTick();
  return { ...f, result: result.accounts[0].processed[0], history: await f.service.history(session) };
}

test("credential-labelled message text is review input before disclosure redaction and cannot authorize actions", async () => {
  const cases = [
    ["password", "password: synthetic_example"],
    ["api_key", "api_key=synthetic_example"],
    ["passcode", "passcode: synthetic_example"],
  ];
  for (const [id, text] of cases) {
    const { result, history, calls } = await run(text, `msg_${id}`);
    assert.equal(result.state, "REVIEW_REQUIRED", id);
    assert.equal(result.acknowledgement, "read", id);
    assert.equal(calls.issue, 0, `${id}: no task`);
    assert.equal(calls.reply, 0, `${id}: no reply`);
    assert.equal(calls.ack, 1, `${id}: terminal review may acknowledge`);
    assert.equal(history[0].requiresReview, true, id);
    assert.ok(history[0].sensitiveReasons.includes("account_security"), id);
  }
});

test("redaction preserves credential labels without retaining their synthetic values", () => {
  for (const [label, input] of [
    ["password", "password: synthetic_example"],
    ["api_key", "api_key=synthetic_example"],
    ["passcode", "passcode: synthetic_example"],
  ]) {
    const redacted = supportAutomationInternals.redactMessageText(input);
    assert.match(redacted, new RegExp(`^${label.replace("_", "[_ -]")}=\\[redacted\\]$`, "i"));
    assert.doesNotMatch(redacted, /synthetic_example/);
    assert.doesNotMatch(redacted, /\$1/);
  }
});
