import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseApiAccessEnvironment } from "../src/config.js";

const templateUrl = new URL("../template.yaml", import.meta.url);

function baseEnvironment(overrides = {}) {
  return {
    API_ACCESS_ENABLED: "true",
    API_ACCESS_MODE: "live",
    API_KEY_PEPPER: "k".repeat(64),
    API_ACCESS_ADMIN_SECRET: "a".repeat(64),
    API_ACCOUNTS_TABLE: "accounts",
    API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage",
    API_USAGE_IDEMPOTENCY_TABLE: "idempotency",
    API_SUBSCRIPTION_EVENTS_TABLE: "events",
    API_CUSTOMER_ACCOUNTS_ENABLED: "true",
    API_CUSTOMER_AUTH_TABLE: "auth",
    API_CUSTOMER_AUTH_PEPPER: "c".repeat(64),
    API_CUSTOMER_AUTH_EMAIL_SENDER: "hello@example.com",
    API_CUSTOMER_TOTP_ENABLED: "false",
    API_ADMIN_CRM_ENABLED: "false",
    API_SUBSCRIPTION_BILLING_ENABLED: "false",
    SITE_ORIGIN: "https://www.solve-lang.com",
    ...overrides,
  };
}

test("admin CRM is off by default and requires its dedicated table only when enabled", () => {
  const disabled = parseApiAccessEnvironment(baseEnvironment());
  assert.equal(disabled.adminCrmEnabled, false);
  assert.equal(disabled.adminCrmTable, undefined);
  assert.equal(disabled.adminCrmProfileIndex, "RecordTypeUpdatedAtIndex");

  assert.throws(
    () => parseApiAccessEnvironment(baseEnvironment({ API_ADMIN_CRM_ENABLED: "true" })),
    /API_ADMIN_CRM_TABLE is required/,
  );

  const enabled = parseApiAccessEnvironment(baseEnvironment({
    API_ADMIN_CRM_ENABLED: "true",
    API_ADMIN_CRM_TABLE: "admin-crm",
  }));
  assert.equal(enabled.adminCrmEnabled, true);
  assert.equal(enabled.adminCrmTable, "admin-crm");
});

test("SAM CRM storage is opt-in, retained, encrypted, PITR-protected, and isolated from the API-key authorizer", async () => {
  const source = await readFile(templateUrl, "utf8");
  assert.match(source, /AdminCrmEnabled:[\s\S]*Default: "false"/);
  assert.match(source, /AdminCrmRequirements:/);
  assert.match(source, /Admin CRM requires customer accounts to be enabled/);
  assert.match(source, /AdminCrmTable:[\s\S]*Condition: AdminCrmFeatureEnabled/);
  assert.match(source, /AdminCrmTable:[\s\S]*DeletionPolicy: Retain[\s\S]*UpdateReplacePolicy: Retain/);
  assert.match(source, /AdminCrmTable:[\s\S]*PointInTimeRecoveryEnabled: true/);
  assert.match(source, /AdminCrmTable:[\s\S]*SSEEnabled: true/);
  assert.match(source, /API_ADMIN_CRM_ENABLED: !Ref AdminCrmEnabled/);
  assert.match(source, /API_ADMIN_CRM_TABLE: !If \[AdminCrmFeatureEnabled, !Ref AdminCrmTable, disabled\]/);

  for (const path of [
    "/internal/admin/customers",
    "/internal/admin/customers/profile",
    "/internal/admin/customers/notes",
    "/internal/admin/customers/tasks",
    "/internal/admin/customers/tasks/update",
  ]) assert.match(source, new RegExp(`Path: ${path.replaceAll("/", "\\/")}`));

  const authorizer = source.split("ApiKeyAuthorizerFunction:")[1] ?? "";
  assert.doesNotMatch(authorizer, /AdminCrmTable|API_ADMIN_CRM/);
});

test("admin CRM addition does not weaken billing boundary or inject Stripe configuration when billing is disabled", async () => {
  const source = await readFile(templateUrl, "utf8");
  assert.match(source, /SubscriptionBillingRemainsTestOnly:/);
  assert.match(source, /Subscription billing is test-mode only until production review is complete/);
  assert.match(source, /API_SUBSCRIPTION_BILLING_ENABLED: !Ref SubscriptionBillingEnabled/);
  assert.match(source, /AdminCrmEnabledState:/);
});
