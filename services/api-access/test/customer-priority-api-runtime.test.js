import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPriorityCustomerSessionAuth } from "../src/customer-priority-session-auth.js";
import { createPriorityUsageService } from "../src/customer-priority-usage.js";
import { createCustomerPriorityRuntime, parseCustomerPriorityRuntimeEnvironment } from "../src/customer-priority-runtime-handler.js";

const ACCOUNT_ID = `acct_${"a".repeat(32)}`;
const SESSION_ID = "b".repeat(32);
const SECRET = "A".repeat(43);
const TOKEN = `sess_${SESSION_ID}_${SECRET}`;
const PEPPER = "customer-auth-pepper-0123456789-abcdefghijklmnopqrstuvwxyz";

function digest(label, value) {
  return createHmac("sha256", PEPPER).update(`${label}:${value}`).digest("hex");
}

class FakeDocumentClient {
  constructor(records = {}) { this.records = records; this.calls = []; }
  async send(command) {
    this.calls.push(command.input);
    const key = command.input.Key?.authKey;
    return { Item: key ? this.records[key] : undefined };
  }
}

test("priority session verifier is read-only, version-bound, access-checked, and CSRF-bound", async () => {
  const csrf = "csrf-token-1234567890";
  const client = new FakeDocumentClient({
    [`session#${SESSION_ID}`]: {
      kind: "session",
      accountId: ACCOUNT_ID,
      email: "customer@example.com",
      secretFingerprint: digest("session", TOKEN),
      csrfFingerprint: digest("csrf", csrf),
      csrfToken: csrf,
      authVersion: 3,
      expiresAt: 1_900_000_000,
    },
    [`account#${ACCOUNT_ID}`]: {
      kind: "account",
      accountId: ACCOUNT_ID,
      email: "customer@example.com",
      authVersion: 3,
    },
  });
  const accessCalls = [];
  const auth = createPriorityCustomerSessionAuth({
    documentClient: client,
    tableName: "customer-auth",
    pepper: PEPPER,
    accountAccess: { async assertActive(accountId) { accessCalls.push(accountId); } },
    now: () => 1_800_000_000_000,
  });
  const session = await auth.authenticate(`other=1; sl_api_session=${TOKEN}`);
  assert.equal(session.accountId, ACCOUNT_ID);
  assert.equal(session.authVersion, 3);
  assert.deepEqual(accessCalls, [ACCOUNT_ID]);
  assert.equal(client.calls.length, 2);
  assert.ok(client.calls.every((call) => call.ConsistentRead === true));
  auth.assertCsrf(session, csrf);
  assert.throws(() => auth.assertCsrf(session, "wrong"), /Request verification failed/);
});

test("priority session verifier fails closed on stale auth version without writing", async () => {
  const client = new FakeDocumentClient({
    [`session#${SESSION_ID}`]: {
      kind: "session",
      accountId: ACCOUNT_ID,
      email: "customer@example.com",
      secretFingerprint: digest("session", TOKEN),
      csrfFingerprint: digest("csrf", "csrf-token-1234567890"),
      authVersion: 2,
      expiresAt: 1_900_000_000,
    },
    [`account#${ACCOUNT_ID}`]: { kind: "account", accountId: ACCOUNT_ID, email: "customer@example.com", authVersion: 3 },
  });
  const auth = createPriorityCustomerSessionAuth({
    documentClient: client,
    tableName: "customer-auth",
    pepper: PEPPER,
    accountAccess: { async assertActive() { throw new Error("must not reach access check"); } },
    now: () => 1_800_000_000_000,
  });
  await assert.rejects(() => auth.authenticate(`sl_api_session=${TOKEN}`), (error) => error?.statusCode === 401 && error?.code === "session_invalid");
  assert.equal(client.calls.length, 2);
});

test("focused usage adapter enforces subscription and plan quota semantics", async () => {
  const calls = [];
  const usage = createPriorityUsageService({
    now: () => Date.parse("2026-08-15T00:00:00Z"),
    store: {
      async getAccount(accountId) { return { accountId, plan: "developer", subscriptionStatus: "active" }; },
      async consumeUsage(input) { calls.push(input); return { status: "consumed", used: 25 }; },
    },
  });
  const result = await usage.consumeUsage({ accountId: ACCOUNT_ID, credits: 5, idempotencyKey: "priority:req-12345678" });
  assert.equal(result.limit, 1000);
  assert.equal(result.used, 25);
  assert.equal(result.remaining, 975);
  assert.equal(result.charged, 5);
  assert.equal(calls[0].limit, 1000);
  assert.equal(calls[0].credits, 5);

  const inactive = createPriorityUsageService({
    store: {
      async getAccount() { return { plan: "developer", subscriptionStatus: "none" }; },
      async consumeUsage() { throw new Error("must not consume"); },
    },
  });
  await assert.rejects(() => inactive.consumeUsage({ accountId: ACCOUNT_ID, credits: 1, idempotencyKey: "priority:req-12345678" }), (error) => error?.code === "subscription_inactive");
});

test("runtime defaults off without requiring production table names or secrets", async () => {
  const environment = {
    PRIORITY_API_ENABLED: "false",
    PRIORITY_QUEUE_ENABLED: "false",
    CUSTOMER_PRIORITY_ENABLED: "false",
    PRIORITY_PROVIDER_EXECUTION_ENABLED: "false",
    SITE_ORIGIN: "https://www.solve-lang.com",
  };
  const parsed = parseCustomerPriorityRuntimeEnvironment(environment);
  assert.equal(parsed.priorityApiEnabled, false);
  assert.equal(parsed.customerPriorityEnabled, false);
  const application = createCustomerPriorityRuntime({ environment });
  const response = await application({ rawPath: "/customer/priority/source", requestContext: { http: { method: "POST" } } });
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).code, "customer_priority_disabled");
});

test("runtime configuration rejects impossible gate combinations", () => {
  const base = { SITE_ORIGIN: "https://www.solve-lang.com" };
  assert.throws(() => parseCustomerPriorityRuntimeEnvironment({ ...base, CUSTOMER_PRIORITY_ENABLED: "true" }), /requires the priority API and queue/);
  assert.throws(() => parseCustomerPriorityRuntimeEnvironment({ ...base, PRIORITY_PROVIDER_EXECUTION_ENABLED: "true" }), /requires customer priority/);
});

test("priority API attachment stack is same-host, default-off, route-bounded, and contains no billing/email/admin/provider secret", async () => {
  const template = await readFile(new URL("../customer-priority-api-template.yaml", import.meta.url), "utf8");
  assert.match(template, /ExistingApiId:/);
  assert.match(template, /PriorityApiEnabled:/);
  assert.match(template, /PriorityQueueEnabled:/);
  assert.match(template, /CustomerPriorityEnabled:/);
  assert.match(template, /ProviderExecutionEnabled:/);
  assert.ok((template.match(/Default: "false"/g) ?? []).length >= 4);
  for (const route of [
    "POST /customer/priority/source",
    "POST /customer/priority/quote",
    "POST /customer/priority/jobs",
    "GET /customer/priority/jobs/{jobId}",
  ]) assert.ok(template.includes(route), route);
  assert.doesNotMatch(template, /AWS::ApiGatewayV2::Api/);
  assert.doesNotMatch(template, /SES|STRIPE|Stripe|API_ACCESS_ADMIN_SECRET|PROVIDER_(API_)?KEY|secrets\./);
  assert.match(template, /dynamodb:GetItem/);
  assert.match(template, /dynamodb:TransactWriteItems/);
  assert.doesNotMatch(template, /dynamodb:Scan|dynamodb:Query|dynamodb:DeleteItem|dynamodb:UpdateItem/);
  assert.match(template, /s3:GetObject/);
  assert.match(template, /s3:PutObject/);
  assert.doesNotMatch(template, /s3:DeleteObject|s3:ListBucket/);
  assert.match(template, /\/customer\/\*/);
});
