import assert from "node:assert/strict";
import test from "node:test";
import { parseApiKeyAuthorizerEnvironment } from "../src/config.js";
import { parsePriorityWorkerEnvironment } from "../src/priority-config.js";

function authorizerEnvironment(overrides = {}) {
  return {
    API_ACCESS_ENABLED: "true",
    API_ACCESS_MODE: "live",
    API_KEY_PEPPER: "k".repeat(64),
    API_ACCOUNTS_TABLE: "accounts",
    API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage",
    API_USAGE_IDEMPOTENCY_TABLE: "usage-idempotency",
    ...overrides,
  };
}

test("API authorizer does not require customer auth storage when customer accounts are disabled", () => {
  const environment = parseApiKeyAuthorizerEnvironment(authorizerEnvironment());
  assert.equal(environment.customerAccountsEnabled, false);
  assert.equal(environment.customerAuthTable, undefined);
});

test("API authorizer requires CustomerAuthTable when customer accounts are enabled", () => {
  assert.throws(
    () => parseApiKeyAuthorizerEnvironment(authorizerEnvironment({ API_CUSTOMER_ACCOUNTS_ENABLED: "true" })),
    /API_CUSTOMER_AUTH_TABLE is required/,
  );
  const environment = parseApiKeyAuthorizerEnvironment(authorizerEnvironment({
    API_CUSTOMER_ACCOUNTS_ENABLED: "true",
    API_CUSTOMER_AUTH_TABLE: "customer-auth",
  }));
  assert.equal(environment.customerAccountsEnabled, true);
  assert.equal(environment.customerAuthTable, "customer-auth");
});

test("priority worker account verification remains optional for server canaries", () => {
  const base = {
    API_PRIORITY_JOBS_TABLE: "priority-jobs",
    API_PRIORITY_LANE: "standard",
  };
  assert.equal(parsePriorityWorkerEnvironment(base).customerAuthTable, undefined);
  assert.equal(parsePriorityWorkerEnvironment({
    ...base,
    API_CUSTOMER_AUTH_TABLE: "customer-auth",
  }).customerAuthTable, "customer-auth");
});
