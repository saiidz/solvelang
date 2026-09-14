import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRuntimeImapSupportProvider, parseSupportAutomationRuntimeEnvironment } from "../src/support-automation-runtime-handler.js";

function env(extra = {}) {
  return {
    API_SUPPORT_AUTOMATION_ENABLED: "true",
    API_SUPPORT_AUTOMATION_ACTIVATION_ENABLED: "false",
    API_SUPPORT_AUTOMATION_RUNTIME_MODE: "worker",
    API_SUPPORT_AUTOMATION_TABLE: "support-table",
    API_CUSTOMER_AUTH_TABLE: "customer-auth-table",
    API_SUPPORT_AUTOMATION_MAIL_HOSTS: "mx.solve.test",
    SITE_ORIGIN: "https://www.solve-lang.com",
    ...extra,
  };
}

test("runtime accepts only bounded approved mail hosts and reply recipients while keeping SMTP sending off by default", () => {
  const parsed = parseSupportAutomationRuntimeEnvironment(env({ API_SUPPORT_AUTOMATION_MAIL_HOSTS: "MX.SOLVE.TEST,mx2.solve.test", API_SUPPORT_AUTOMATION_REPLY_RECIPIENTS: "Canary@Example.test,owner@example.test" }));
  assert.deepEqual(parsed.approvedMailHosts, ["mx.solve.test", "mx2.solve.test"]);
  assert.deepEqual(parsed.approvedReplyRecipients, ["canary@example.test", "owner@example.test"]);
  assert.equal(parsed.mailSendEnabled, false);
  assert.equal(parseSupportAutomationRuntimeEnvironment(env({ API_SUPPORT_AUTOMATION_MAIL_SEND_ENABLED: "true" })).mailSendEnabled, true);
  for (const value of ["127.0.0.1", "mx.solve.test,https://evil.test", "mx.solve.test\nother.test", Array(10).fill("mx.solve.test").map((v, i) => `${i}.${v}`).join(",")]) {
    assert.throws(() => parseSupportAutomationRuntimeEnvironment(env({ API_SUPPORT_AUTOMATION_MAIL_HOSTS: value })), /MAIL_HOSTS is invalid/);
  }
  for (const value of ["not-an-email", "a@example.test,bad", "a@example.test\nb@example.test", Array(9).fill(0).map((_, i) => `u${i}@example.test`).join(",")]) {
    assert.throws(() => parseSupportAutomationRuntimeEnvironment(env({ API_SUPPORT_AUTOMATION_REPLY_RECIPIENTS: value })), /REPLY_RECIPIENTS is invalid/);
  }
});

test("runtime mail wrapper anchors cutover to the durable initialization timestamp", async () => {
  const captures = [];
  const providerFactory = () => ({
    async captureCutover(input, startedAt) { captures.push({ input, startedAt }); return { sourceId: "f".repeat(64), uidValidity: 1, nextUid: 2 }; },
    async scanNew() { return { messages: [], nextCursor: 2 }; },
    async readMessage() { return {}; },
    async sendReply() { return {}; },
  });
  const startedAt = "2026-09-14T01:00:00.000Z";
  const input = { accountId: `acct_${"a".repeat(32)}` };
  const provider = createRuntimeImapSupportProvider({ credentialResolver() {}, allowedHosts: ["mx.solve.test"], initializationStartResolver: async (value) => { assert.equal(value, input); return startedAt; }, providerFactory });
  await provider.captureCutover(input);
  await provider.captureCutover(input);
  assert.deepEqual(captures, [{ input, startedAt }, { input, startedAt }]);
});

test("runtime mail wrapper never derives send authority from incoming sender data", async () => {
  const calls = [];
  const providerFactory = (options) => {
    calls.push(options);
    return {
      async captureCutover() { return { sourceId: "f".repeat(64), uidValidity: 1, nextUid: 2 }; },
      async scanNew() { return { messages: [], nextCursor: 2 }; },
      async readMessage() { return {}; },
      async sendReply(_input, message) { return { id: message.to }; },
    };
  };
  const disabled = createRuntimeImapSupportProvider({ credentialResolver() {}, allowedHosts: ["mx.solve.test"], allowSend: false, allowedReplyRecipients: ["customer@example.test"], providerFactory });
  await assert.rejects(() => disabled.sendReply({}, { to: "customer@example.test" }), (error) => error.code === "smtp_reply_not_authorized");
  assert.equal(calls.length, 1);

  const emptyAllowlist = createRuntimeImapSupportProvider({ credentialResolver() {}, allowedHosts: ["mx.solve.test"], allowSend: true, providerFactory });
  await assert.rejects(() => emptyAllowlist.sendReply({}, { to: "customer@example.test" }), (error) => error.code === "smtp_reply_not_authorized");
  assert.equal(calls.length, 2);

  const enabled = createRuntimeImapSupportProvider({ credentialResolver() {}, allowedHosts: ["mx.solve.test"], allowSend: true, allowedReplyRecipients: ["customer@example.test"], providerFactory });
  await assert.rejects(() => enabled.sendReply({}, { to: "attacker@example.test" }), (error) => error.code === "smtp_reply_not_authorized");
  assert.equal(calls.length, 3, "denied incoming sender must not create a send-capable provider");
  const receipt = await enabled.sendReply({}, { to: "CUSTOMER@example.test" });
  assert.equal(receipt.id, "customer@example.test");
  assert.deepEqual(calls.at(-1).allowedReplyRecipients, ["customer@example.test"]);
  assert.equal(calls.at(-1).allowSend, true);
});

test("production foundation pins the approved Mailcow host and requires separate send plus recipient gates that default off", async () => {
  const template = await readFile(new URL("../support-automation-production-stack.yaml", import.meta.url), "utf8");
  assert.match(template, /SupportAutomationMailHosts:[\s\S]*Default: mx1\.upcomingsounds\.com/);
  assert.match(template, /SupportAutomationMailSendEnabled:[\s\S]*Default: "false"/);
  assert.match(template, /SupportAutomationReplyRecipients:[\s\S]*Default: ""/);
  assert.match(template, /SupportAutomationMailSendRequiresActivation:/);
  assert.match(template, /explicit deployment-owned recipient allowlist/);
  assert.match(template, /API_SUPPORT_AUTOMATION_MAIL_HOSTS: !Ref SupportAutomationMailHosts/);
  assert.match(template, /API_SUPPORT_AUTOMATION_MAIL_SEND_ENABLED: !Ref SupportAutomationMailSendEnabled/);
  assert.match(template, /API_SUPPORT_AUTOMATION_REPLY_RECIPIENTS: !Ref SupportAutomationReplyRecipients/);
  const apiBlock = template.slice(template.indexOf("SupportAutomationApiFunction:"), template.indexOf("SupportAutomationWorkerFunction:"));
  assert.doesNotMatch(apiBlock, /secretsmanager:GetSecretValue/);
  assert.doesNotMatch(apiBlock, /API_SUPPORT_AUTOMATION_REPLY_RECIPIENTS/);
});
