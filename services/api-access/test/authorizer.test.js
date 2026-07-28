import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createApiKeyAuthorizer } from "../src/authorizer.js";

test("authorizer remains disabled until explicitly enabled", async () => {
  let called = false;
  const authorizer = createApiKeyAuthorizer({
    enabled: false,
    service: {
      authorize: async () => { called = true; return {}; },
      consumeUsage: async () => { called = true; return {}; },
    },
  });
  assert.deepEqual(await authorizer({ headers: { authorization: "Bearer secret" } }), { isAuthorized: false });
  assert.equal(called, false);
});

test("authorizer charges one quota unit and returns only sanitized account context", async () => {
  const calls = [];
  const service = {
    authorize: async ({ authorization, requiredScope }) => {
      assert.equal(authorization, "Bearer sl_test_key");
      assert.equal(requiredScope, "repository:audit");
      calls.push("authorize");
      return {
        accountId: "acct_1",
        keyId: "key_1",
        plan: "pro",
        scopes: ["repository:audit"],
        subscriptionStatus: "active",
        secret: "must-not-leak",
      };
    },
    consumeUsage: async ({ accountId, units, idempotencyKey }) => {
      calls.push("usage");
      assert.equal(accountId, "acct_1");
      assert.equal(units, 1);
      assert.equal(idempotencyKey, `request_${createHash("sha256").update("request-123").digest("hex")}`);
      return { remaining: 9_999 };
    },
  };
  const authorizer = createApiKeyAuthorizer({ service, enabled: true });
  const result = await authorizer({
    headers: { authorization: "Bearer sl_test_key" },
    requestContext: { requestId: "request-123" },
  });
  assert.deepEqual(calls, ["authorize", "usage"]);
  assert.deepEqual(result, {
    isAuthorized: true,
    context: {
      accountId: "acct_1",
      keyId: "key_1",
      plan: "pro",
      scopes: "repository:audit",
      subscriptionStatus: "active",
      usageRemaining: 9_999,
    },
  });
  assert.ok(!JSON.stringify(result).includes("must-not-leak"));
});

test("authorizer denies requests when quota consumption fails", async () => {
  const authorizer = createApiKeyAuthorizer({
    enabled: true,
    service: {
      authorize: async () => ({
        accountId: "acct_1",
        keyId: "key_1",
        plan: "developer",
        scopes: ["repository:audit"],
        subscriptionStatus: "active",
      }),
      consumeUsage: async () => { throw new Error("quota exhausted"); },
    },
  });
  assert.deepEqual(await authorizer({
    headers: { authorization: "Bearer valid" },
    requestContext: { requestId: "request-456" },
  }), { isAuthorized: false });
});

test("authorizer denies requests without a stable request identifier", async () => {
  let usageCalled = false;
  const authorizer = createApiKeyAuthorizer({
    enabled: true,
    service: {
      authorize: async () => ({
        accountId: "acct_1",
        keyId: "key_1",
        plan: "developer",
        scopes: ["repository:audit"],
        subscriptionStatus: "active",
      }),
      consumeUsage: async () => { usageCalled = true; return { remaining: 1 }; },
    },
  });
  assert.deepEqual(await authorizer({ headers: { authorization: "Bearer valid" } }), { isAuthorized: false });
  assert.equal(usageCalled, false);
});

test("authorizer converts all validation and storage failures into denial", async () => {
  const authorizer = createApiKeyAuthorizer({
    enabled: true,
    service: {
      authorize: async () => { throw new Error("provider URL with token=secret"); },
      consumeUsage: async () => ({ remaining: 1 }),
    },
  });
  assert.deepEqual(await authorizer({
    headers: { authorization: "Bearer invalid" },
    requestContext: { requestId: "request-789" },
  }), { isAuthorized: false });
});
