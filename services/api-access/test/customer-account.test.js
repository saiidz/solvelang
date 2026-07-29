import assert from "node:assert/strict";
import test from "node:test";
import { createCustomerAccountService } from "../src/customer-account.js";

const fixedNow = Date.UTC(2026, 6, 29, 16, 0, 0);
const emptyUsageReader = { getUsage: async () => 0 };

test("returns sanitized subscription, quota, and key data", async () => {
  const store = {
    getAccount: async () => ({
      accountId: "acct_1",
      email: "dev@example.com",
      plan: "pro",
      subscriptionStatus: "active",
      currentPeriodEnd: fixedNow + 1_000,
      stripeCustomerId: "cus_secret",
      stripeSubscriptionId: "sub_secret",
    }),
    listKeys: async () => [{
      keyId: "key_1",
      accountId: "acct_1",
      name: "Production",
      mode: "test",
      prefix: "sl_test_key_1",
      lastFour: "abcd",
      scopes: ["repository:audit"],
      createdAt: "2026-07-29T10:00:00.000Z",
      secretFingerprint: "must-not-leak",
    }],
  };
  const usageCalls = [];
  const service = createCustomerAccountService({
    store,
    apiAccessService: { issueApiKey() {}, revokeApiKey() {} },
    usageReader: { getUsage: async (...args) => { usageCalls.push(args); return 321; } },
    now: () => fixedNow,
  });
  const dashboard = await service.getDashboard({ accountId: "acct_1", email: "dev@example.com" });
  assert.equal(dashboard.subscription.plan, "pro");
  assert.deepEqual(dashboard.usage, { period: "2026-07", used: 321, limit: 10_000, remaining: 9_679 });
  assert.deepEqual(usageCalls, [["acct_1", "2026-07"]]);
  assert.equal(dashboard.keys[0].lastFour, "abcd");
  assert.ok(!JSON.stringify(dashboard).includes("must-not-leak"));
  assert.ok(!JSON.stringify(dashboard).includes("cus_secret"));
  assert.ok(!JSON.stringify(dashboard).includes("sub_secret"));
});

test("derives key ownership only from the authenticated session", async () => {
  const calls = [];
  const service = createCustomerAccountService({
    store: { getAccount: async () => undefined, listKeys: async () => [] },
    apiAccessService: {
      issueApiKey: async (input) => { calls.push(["issue", input]); return { apiKey: "once" }; },
      revokeApiKey: async (input) => { calls.push(["revoke", input]); return { revoked: true }; },
    },
    usageReader: emptyUsageReader,
    now: () => fixedNow,
  });
  const session = { accountId: "acct_session", email: "dev@example.com" };
  await service.issueKey(session, { accountId: "acct_attacker", name: "CI" });
  await service.revokeKey(session, { accountId: "acct_attacker", keyId: "key_1" });
  assert.deepEqual(calls, [
    ["issue", { accountId: "acct_session", name: "CI", scopes: ["repository:audit"] }],
    ["revoke", { accountId: "acct_session", keyId: "key_1" }],
  ]);
});

test("shows an unsubscribed customer shell before Checkout without reading usage", async () => {
  let usageRead = false;
  const service = createCustomerAccountService({
    store: { getAccount: async () => undefined, listKeys: async () => [] },
    apiAccessService: { issueApiKey() {}, revokeApiKey() {} },
    usageReader: { getUsage: async () => { usageRead = true; return 0; } },
    now: () => fixedNow,
  });
  const dashboard = await service.getDashboard({ accountId: "acct_new", email: "new@example.com" });
  assert.equal(dashboard.subscription.status, "none");
  assert.equal(dashboard.subscription.plan, null);
  assert.deepEqual(dashboard.keys, []);
  assert.equal(usageRead, false);
});
