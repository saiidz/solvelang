import assert from "node:assert/strict";
import test from "node:test";
import { parseApiAccessEnvironment } from "../src/config.js";

function env(extra = {}) {
  return {
    API_ACCESS_ENABLED: "true",
    API_ACCESS_MODE: "test",
    API_KEY_PEPPER: "p".repeat(32),
    API_ACCESS_ADMIN_SECRET: "a".repeat(32),
    SITE_ORIGIN: "https://www.solve-lang.com",
    API_ACCOUNTS_TABLE: "accounts",
    API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage",
    API_USAGE_IDEMPOTENCY_TABLE: "idem",
    API_SUBSCRIPTION_EVENTS_TABLE: "events",
    API_CUSTOMER_ACCOUNTS_ENABLED: "true",
    API_CUSTOMER_AUTH_TABLE: "auth",
    API_CUSTOMER_AUTH_PEPPER: "c".repeat(32),
    API_CUSTOMER_AUTH_EMAIL_SENDER: "support@example.com",
    ...extra,
  };
}

test("support automation defaults completely off even when customer accounts are enabled", () => {
  const parsed = parseApiAccessEnvironment(env());
  assert.equal(parsed.supportAutomationEnabled, false);
  assert.equal(parsed.supportAutomationActivationEnabled, false);
  assert.equal(parsed.supportAutomationTable, undefined);
});

test("support automation implementation can be enabled while activation remains independently off", () => {
  const parsed = parseApiAccessEnvironment(env({ API_SUPPORT_AUTOMATION_ENABLED: "true", API_SUPPORT_AUTOMATION_TABLE: "support" }));
  assert.equal(parsed.supportAutomationEnabled, true);
  assert.equal(parsed.supportAutomationActivationEnabled, false);
  assert.equal(parsed.supportAutomationTable, "support");
});

test("activation cannot be enabled without implementation and customer accounts", () => {
  assert.throws(() => parseApiAccessEnvironment(env({ API_SUPPORT_AUTOMATION_ACTIVATION_ENABLED: "true" })), /activation requires support automation/);
  assert.throws(() => parseApiAccessEnvironment(env({ API_CUSTOMER_ACCOUNTS_ENABLED: "false", API_SUPPORT_AUTOMATION_ENABLED: "true", API_SUPPORT_AUTOMATION_TABLE: "support" })), /requires customer accounts/);
});
