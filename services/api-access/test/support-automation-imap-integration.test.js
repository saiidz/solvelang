import assert from "node:assert/strict";
import test from "node:test";
import { createSupportAutomationService } from "../src/support-automation.js";
import { createMemorySupportAutomationStore } from "../src/support-automation-store.js";

const ACCOUNT_ID = `acct_${"a".repeat(32)}`;
const session = { accountId: ACCOUNT_ID, email: "owner@example.test" };
const mailSecret = `arn:aws:secretsmanager:us-east-1:123456789012:secret:solvelang/support-automation/${ACCOUNT_ID}/mail-AbCd`;
const linearSecret = `arn:aws:secretsmanager:us-east-1:123456789012:secret:solvelang/support-automation/${ACCOUNT_ID}/linear-EfGh`;
const host = "mx.solve.test";
const input = { provider: "imap_smtp", inboxEmail: "hello@solve.test", mailCredentialSecretArn: mailSecret, mailHost: host, mailFolder: "INBOX", taskProvider: "linear", linearCredentialSecretArn: linearSecret, linearTeamId: "team_test", policyVersion: "support-v1", allowedActions: ["create_linear_issue", "send_reply"] };

function fixture(overrides = {}) {
  const store = createMemorySupportAutomationStore();
  const calls = { cutover: 0, scan: 0, read: 0, issue: 0, reply: 0 };
  const sourceId = "f".repeat(64);
  const id = `imap:${sourceId}:7:100`;
  const mail = {
    async captureCutover() { calls.cutover++; return { sourceId, uidValidity: 7, nextUid: 100 }; },
    async scanNew(_input, cutover, cursor) { calls.scan++; assert.equal(cutover.nextUid, 100); assert.equal(cursor, 100); return { messages: [{ id }], nextCursor: 101 }; },
    async readMessage(_input, _cutover, value) { calls.read++; assert.equal(value, id); return { id, rfcMessageId: "<m100@customer.test>", from: "customer@example.test", to: "hello@solve.test", subject: "Setup help", text: "Please help with onboarding." }; },
    async sendReply() { calls.reply++; return { id: "reply-100", acceptedForDelivery: true, delivered: false }; },
    ...overrides.mail,
  };
  const gmail = { async getProfile() { throw new Error("gmail must not run"); }, async listUnread() { throw new Error("gmail must not run"); }, async getMessage() { throw new Error("gmail must not run"); }, async markRead() { throw new Error("gmail must not run"); }, async sendReply() { throw new Error("gmail must not run"); } };
  const linear = { async createIssue() { calls.issue++; return { id: "LIN-1", url: "https://linear.test/LIN-1" }; }, ...overrides.linear };
  let clock = Date.parse("2026-09-14T01:00:00Z");
  const service = createSupportAutomationService({ store, gmail, mail, linear, allowedMailHosts: [host], activationEnabled: true, now: () => ++clock, idFactory: (() => { let n = 0; return () => `claim_${++n}`; })(), logger: { error() {} } });
  return { store, service, calls, id, sourceId };
}

async function configureAndInitialize(f) {
  const configured = await f.service.configure(session, input);
  assert.equal(configured.automationState, "PAUSED");
  assert.equal(configured.sourceInitialized, false);
  const resumed = await f.service.resume(session);
  assert.equal(resumed.automationState, "INITIALIZING");
  assert.equal(resumed.initializing, true);
  const tick = await f.service.processTick();
  assert.equal(tick.accounts[0].state, "ACTIVE");
  return tick;
}

test("IMAP selection is host allowlisted, captures cutover before activation, and processes only stable post-cutover UIDs", async () => {
  const f = fixture();
  await assert.rejects(() => createSupportAutomationService({ store: f.store, gmail: {}, mail: {}, linear: {}, allowedMailHosts: [], activationEnabled: true }).configure(session, input), (error) => error.code === "support_mail_host_not_approved");
  const tick = await configureAndInitialize(f);
  assert.equal(f.calls.cutover, 1); assert.equal(f.calls.scan, 1); assert.equal(f.calls.read, 1); assert.equal(f.calls.issue, 1); assert.equal(f.calls.reply, 1);
  assert.equal(tick.accounts[0].processed[0].state, "PROCESSED");
  const config = await f.store.getConfig(ACCOUNT_ID);
  assert.equal(config.sourceState.uidValidity, 7); assert.equal(config.sourceState.nextUid, 100); assert.equal(config.sourceState.cursor, 101);
  const status = await f.service.status(session);
  assert.equal(status.provider, "imap_smtp"); assert.equal(status.sourceInitialized, true); assert.equal(status.mailHost, host);
});

test("crash after a completed event but before cursor CAS replays safely without duplicate actions", async () => {
  const f = fixture(); await configureAndInitialize(f);
  const config = await f.store.getConfig(ACCOUNT_ID);
  f.store._configs.set(ACCOUNT_ID, { ...config, sourceState: { ...config.sourceState, cursor: 100 } });
  const second = await f.service.processTick();
  assert.equal(second.accounts[0].processed[0].duplicate, true);
  assert.equal(f.calls.issue, 1); assert.equal(f.calls.reply, 1);
  assert.equal((await f.store.getConfig(ACCOUNT_ID)).sourceState.cursor, 101);
});

test("an unexpired event lease prevents cursor advancement so a concurrent worker cannot skip the message", async () => {
  const f = fixture();
  await f.service.configure(session, input); await f.service.resume(session);
  await f.service.processTick();
  const config = await f.store.getConfig(ACCOUNT_ID);
  f.store._configs.set(ACCOUNT_ID, { ...config, sourceState: { ...config.sourceState, cursor: 100 } });
  f.store._events.delete(`${ACCOUNT_ID}:${f.id}`);
  await f.store.claimEvent({ accountId: ACCOUNT_ID, eventId: f.id, providerMessageHash: "held", claimId: "other", processingUntil: "2099-01-01T00:00:00.000Z", createdAt: "2026-09-14T01:00:00.000Z", updatedAt: "2026-09-14T01:00:00.000Z" });
  const tick = await f.service.processTick();
  assert.equal(tick.accounts[0].processed[0].state, "PROCESSING");
  assert.equal(tick.accounts[0].cursorAdvanced, false);
  assert.equal((await f.store.getConfig(ACCOUNT_ID)).sourceState.cursor, 100);
});

test("pause during an external action wins before reply and leaves cursor unadvanced", async () => {
  const f = fixture();
  f.service = createSupportAutomationService({ store: f.store, gmail: { async sendReply() {} }, mail: { ...({ async captureCutover() { return { sourceId: f.sourceId, uidValidity: 7, nextUid: 100 }; }, async scanNew() { return { messages: [{ id: f.id }], nextCursor: 101 }; }, async readMessage() { return { id: f.id, rfcMessageId: "<m100@customer.test>", from: "customer@example.test", subject: "Setup help", text: "Please help with onboarding." }; }, async sendReply() { f.calls.reply++; return { id: "reply" }; } }) }, linear: { async createIssue() { f.calls.issue++; const current = await f.store.getConfig(ACCOUNT_ID); await f.store.setState(ACCOUNT_ID, current.revision, "PAUSED", new Date().toISOString()); return { id: "LIN-PAUSE", url: "https://linear.test/pause" }; } }, allowedMailHosts: [host], activationEnabled: true, logger: { error() {} } });
  await f.service.configure(session, input); await f.service.resume(session); const tick = await f.service.processTick();
  assert.equal(tick.accounts[0].state, "STOPPED"); assert.equal(f.calls.reply, 0);
  assert.equal((await f.store.getConfig(ACCOUNT_ID)).sourceState.cursor, 100);
});

test("transport content rejection becomes durable review instead of an endless failed-message retry", async () => {
  const review = Object.assign(new Error("untrusted attachment"), { code: "mail_content_requires_review" });
  const f = fixture({ mail: { async readMessage() { f.calls.read++; throw review; } } });
  const tick = await configureAndInitialize(f);
  assert.equal(tick.accounts[0].processed[0].state, "REVIEW_REQUIRED");
  assert.equal((await f.store.getConfig(ACCOUNT_ID)).sourceState.cursor, 101);
  const history = await f.service.history(session);
  assert.deepEqual(history[0].sensitiveReasons, ["transport:mail_content_requires_review"]);
  assert.equal(f.calls.issue, 0); assert.equal(f.calls.reply, 0);
});
