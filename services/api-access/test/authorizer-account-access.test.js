import assert from "node:assert/strict";
import test from "node:test";
import { createApiKeyAuthorizer } from "../src/authorizer.js";

function event() {
  return {
    headers: { authorization: "Bearer sl_test_key" },
    requestContext: { requestId: "request-account-access-1" },
  };
}

function authorizedContext() {
  return {
    accountId: `acct_${"a".repeat(32)}`,
    keyId: "key_1",
    plan: "pro",
    scopes: ["repository:audit"],
    subscriptionStatus: "active",
  };
}

test("account access is checked after key validation and before quota consumption", async () => {
  const calls = [];
  const authorizer = createApiKeyAuthorizer({
    enabled: true,
    service: {
      async authorize() { calls.push("authorize"); return authorizedContext(); },
      async consumeUsage() { calls.push("usage"); return { remaining: 9 }; },
    },
    accountAccess: {
      async assertActive(accountId) {
        calls.push(`access:${accountId}`);
      },
    },
  });

  const result = await authorizer(event());
  assert.equal(result.isAuthorized, true);
  assert.deepEqual(calls, [
    "authorize",
    `access:${authorizedContext().accountId}`,
    "usage",
  ]);
});

test("restricted API key is denied without consuming quota", async () => {
  let usageCalls = 0;
  const authorizer = createApiKeyAuthorizer({
    enabled: true,
    service: {
      async authorize() { return authorizedContext(); },
      async consumeUsage() { usageCalls += 1; return { remaining: 9 }; },
    },
    accountAccess: {
      async assertActive() { throw new Error("restricted"); },
    },
  });

  assert.deepEqual(await authorizer(event()), { isAuthorized: false });
  assert.equal(usageCalls, 0);
});

test("authorizer rejects malformed account-access integration", () => {
  assert.throws(
    () => createApiKeyAuthorizer({
      enabled: true,
      service: { authorize() {}, consumeUsage() {} },
      accountAccess: {},
    }),
    /Account access service is invalid/,
  );
});
