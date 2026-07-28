import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";

const adminSecret = "a".repeat(64);

function event(method, rawPath, body, headers = {}) {
  return {
    rawPath,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method } },
  };
}

const service = {
  provisionSubscription: async (body) => ({ ...body, normalized: true }),
  issueApiKey: async () => ({ apiKey: "sl_test_once", env: "SOLVELANG_API_KEY=sl_test_once\n" }),
  revokeApiKey: async ({ keyId }) => ({ keyId, revokedAt: "2026-07-28T12:00:00.000Z" }),
  consumeUsage: async () => ({ used: 1, limit: 1_000, remaining: 999 }),
};

test("health remains available while all subscription mutations fail closed", async () => {
  const handler = createApiAccessHandler({ service, enabled: false, adminSecret, siteOrigin: "https://www.solve-lang.com", logger: { error() {} } });
  const health = await handler(event("GET", "/health"));
  assert.equal(health.statusCode, 200);
  assert.deepEqual(JSON.parse(health.body), { status: "ok", service: "solvelang-api-access", enabled: false });

  const denied = await handler(event("POST", "/internal/keys", { accountId: "acct_1" }, { "x-solvelang-admin-secret": adminSecret }));
  assert.equal(denied.statusCode, 503);
  assert.equal(JSON.parse(denied.body).code, "api_access_disabled");
});

test("internal routes require a constant-time admin secret and return the plaintext key only on issuance", async () => {
  const logs = [];
  const handler = createApiAccessHandler({ service, enabled: true, adminSecret, siteOrigin: "https://www.solve-lang.com", logger: { error(record) { logs.push(record); } } });
  const denied = await handler(event("POST", "/internal/keys", {}, { "x-solvelang-admin-secret": "wrong" }));
  assert.equal(denied.statusCode, 403);
  assert.equal(JSON.parse(denied.body).code, "admin_denied");
  assert.ok(!JSON.stringify(logs).includes("wrong"));

  const issued = await handler(event("POST", "/internal/keys", { accountId: "acct_1", name: "Server" }, { "x-solvelang-admin-secret": adminSecret }));
  assert.equal(issued.statusCode, 201);
  assert.equal(JSON.parse(issued.body).apiKey, "sl_test_once");
  assert.equal(issued.headers["cache-control"], "no-store");
});

test("protected identity output uses only authorizer context", async () => {
  const handler = createApiAccessHandler({ service, enabled: true, adminSecret, siteOrigin: "https://www.solve-lang.com", logger: { error() {} } });
  const identityEvent = event("GET", "/v1/whoami");
  identityEvent.requestContext.authorizer = {
    lambda: {
      accountId: "acct_1",
      keyId: "key_1",
      plan: "pro",
      scopes: "repository:audit",
      subscriptionStatus: "active",
      secret: "must-not-leak",
    },
  };
  const response = await handler(identityEvent);
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.deepEqual(body, {
    accountId: "acct_1",
    keyId: "key_1",
    plan: "pro",
    scopes: ["repository:audit"],
    subscriptionStatus: "active",
  });
  assert.ok(!response.body.includes("must-not-leak"));
});

test("invalid JSON and unknown routes return sanitized errors", async () => {
  const handler = createApiAccessHandler({ service, enabled: true, adminSecret, siteOrigin: "https://www.solve-lang.com", logger: { error() {} } });
  const malformed = event("POST", "/internal/keys", undefined, { "x-solvelang-admin-secret": adminSecret });
  malformed.body = "{";
  const invalid = await handler(malformed);
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(JSON.parse(invalid.body), { error: "Invalid request.", code: "invalid_request" });

  const missing = await handler(event("POST", "/internal/missing", {}, { "x-solvelang-admin-secret": adminSecret }));
  assert.equal(missing.statusCode, 404);
});
