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

test("runtime accepts only bounded approved mail hosts and keeps SMTP sending off by default", () => {
  const parsed = parseSupportAutomationRuntimeEnvironment(env({ API_SUPPORT_AUTOMATION_MAIL_HOSTS: "MX.SOLVE.TEST,mx2.solve.test" }));
  assert.deepEqual(parsed.approvedMailHosts, ["mx.solve.test", "mx2.solve.test"]);
  assert.equal(parsed.mailSendEnabled, false);
  assert.equal(parseSupportAutomationRuntimeEnvironment(env({ API_SUPPORT_AUTOMATION_MAIL_SEND_ENABLED: "true" })).mailSendEnabled, true);
  for (const value of ["127.0.0.1", "mx.solve.test,https://evil.test", "mx.solve.test\nother.test", Array(10).fill("mx.solve.test").map((v, i) => `${i}.${v}`).join(",")]) {
    assert.throws(() => parseSupportAutomationRuntimeEnvironment(env({ API_SUPPORT_AUTOMATION_MAIL_HOSTS: value })), /MAIL_HOSTS is invalid/);
  }
});

test("runtime mail wrapper cannot send while disabled and creates a one-recipient transport when enabled", async () => {
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
  const disabled = createRuntimeImapSupportProvider({ credentialResolver() {}, allowedHosts: ["mx.solve.test"], allowSend: false, providerFactory });
  await assert.rejects(() => disabled.sendReply({}, { to: "customer@example.test" }), (error) => error.code === "smtp_reply_not_authorized");
  assert.equal(calls.length, 1);

  const enabled = createRuntimeImapSupportProvider({ credentialResolver() {}, allowedHosts: ["mx.solve.test"], allowSend: true, providerFactory });
  const receipt = await enabled.sendReply({}, { to: "customer@example.test" });
  assert.equal(receipt.id, "customer@example.test");
  assert.deepEqual(calls.at(-1).allowedReplyRecipients, ["customer@example.test"]);
  assert.equal(calls.at(-1).allowSend, true);
});

test("production foundation pins the approved Mailcow host and requires a separate send gate that defaults off", async () => {
  const template = await readFile(new URL("../support-automation-production-stack.yaml", import.meta.url), "utf8");
  assert.match(template, /SupportAutomationMailHosts:[\s\S]*Default: mx1\.upcomingsounds\.com/);
  assert.match(template, /SupportAutomationMailSendEnabled:[\s\S]*Default: "false"/);
  assert.match(template, /SupportAutomationMailSendRequiresActivation:/);
  assert.match(template, /API_SUPPORT_AUTOMATION_MAIL_HOSTS: !Ref SupportAutomationMailHosts/);
  assert.match(template, /API_SUPPORT_AUTOMATION_MAIL_SEND_ENABLED: !Ref SupportAutomationMailSendEnabled/);
  const apiBlock = template.slice(template.indexOf("SupportAutomationApiFunction:"), template.indexOf("SupportAutomationWorkerFunction:"));
  assert.doesNotMatch(apiBlock, /secretsmanager:GetSecretValue/);
});
