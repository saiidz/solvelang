import assert from "node:assert/strict";
import test from "node:test";
import { createApiKeyAuthorizer } from "../src/authorizer.js";

test("authorizer remains disabled until explicitly enabled", async () => {
  let called = false;
  const authorizer = createApiKeyAuthorizer({
    enabled: false,
    service: { authorize: async () => { called = true; return {}; } },
  });
  assert.deepEqual(await authorizer({ headers: { authorization: "Bearer secret" } }), { isAuthorized: false });
  assert.equal(called, false);
});

test("authorizer returns only sanitized account context", async () => {
  const service = {
    authorize: async ({ authorization, requiredScope }) => {
      assert.equal(authorization, "Bearer sl_test_key");
      assert.equal(requiredScope, "repository:audit");
      return {
        accountId: "acct_1",
        keyId: "key_1",
        plan: "pro",
        scopes: ["repository:audit"],
        subscriptionStatus: "active",
        secret: "must-not-leak",
      };
    },
  };
  const authorizer = createApiKeyAuthorizer({ service, enabled: true });
  const result = await authorizer({ headers: { authorization: "Bearer sl_test_key" } });
  assert.deepEqual(result, {
    isAuthorized: true,
    context: {
      accountId: "acct_1",
      keyId: "key_1",
      plan: "pro",
      scopes: "repository:audit",
      subscriptionStatus: "active",
    },
  });
  assert.ok(!JSON.stringify(result).includes("must-not-leak"));
});

test("authorizer converts all validation and storage failures into denial", async () => {
  const authorizer = createApiKeyAuthorizer({
    enabled: true,
    service: { authorize: async () => { throw new Error("provider URL with token=secret"); } },
  });
  assert.deepEqual(await authorizer({ headers: { authorization: "Bearer invalid" } }), { isAuthorized: false });
});
