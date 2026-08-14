import assert from "node:assert/strict";
import test from "node:test";
import { createAccessGuardedApiAccessService } from "../src/account-access-api-service.js";

const ACCOUNT_ID = `acct_${"e".repeat(32)}`;

function fixture({ restricted = false } = {}) {
  const calls = [];
  const service = {
    async reserveSubscriptionCheckout(input) { calls.push(["checkout", input.accountId]); return "checkout"; },
    async provisionSubscription(input) { calls.push(["provision", input.accountId]); return "provision"; },
    async issueApiKey(input) { calls.push(["issue", input.accountId]); return "issue"; },
    async consumeUsage(input) { calls.push(["usage", input.accountId]); return "usage"; },
    async revokeApiKey(input) { calls.push(["revoke", input.accountId]); return "revoke"; },
    async getSubscriptionAccount(input) { calls.push(["read", input]); return { accountId: input }; },
  };
  const access = {
    async assertActive(accountId) {
      calls.push(["access", accountId]);
      if (restricted) throw new Error("restricted");
    },
  };
  return { guarded: createAccessGuardedApiAccessService(service, access), calls };
}

test("customer mutation methods check account access before delegation", async () => {
  for (const [method, result] of [
    ["reserveSubscriptionCheckout", "checkout"],
    ["provisionSubscription", "provision"],
    ["issueApiKey", "issue"],
    ["consumeUsage", "usage"],
  ]) {
    const { guarded, calls } = fixture();
    assert.equal(await guarded[method]({ accountId: ACCOUNT_ID }), result);
    assert.equal(calls[0][0], "access");
    assert.equal(calls[0][1], ACCOUNT_ID);
    assert.equal(calls[1][1], ACCOUNT_ID);
  }
});

test("restricted mutation never reaches the underlying API service", async () => {
  const { guarded, calls } = fixture({ restricted: true });
  await assert.rejects(() => guarded.issueApiKey({ accountId: ACCOUNT_ID }), /restricted/);
  assert.deepEqual(calls, [["access", ACCOUNT_ID]]);
});

test("revocation and reads remain available for cleanup and reconciliation", async () => {
  const { guarded, calls } = fixture({ restricted: true });
  assert.equal(await guarded.revokeApiKey({ accountId: ACCOUNT_ID }), "revoke");
  assert.deepEqual(await guarded.getSubscriptionAccount(ACCOUNT_ID), { accountId: ACCOUNT_ID });
  assert.deepEqual(calls, [["revoke", ACCOUNT_ID], ["read", ACCOUNT_ID]]);
});
