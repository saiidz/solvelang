import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessService } from "../src/service.js";

const pepper = "p".repeat(64);
const now = Date.UTC(2026, 6, 28, 12, 0, 0);

class OrderedAccountStore {
  account;

  async putAccount(next) {
    if (this.account && this.account.subscriptionEventOrder >= next.subscriptionEventOrder) return "stale";
    this.account = { ...this.account, ...structuredClone(next), activeKeyCount: this.account?.activeKeyCount ?? 0 };
    return "updated";
  }

  async getAccount() { return structuredClone(this.account); }
}

function subscription(status, eventCreatedAt, subscriptionEventOrder) {
  return {
    accountId: "acct_1",
    email: "dev@example.com",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    plan: "pro",
    subscriptionStatus: status,
    currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1_000,
    subscriptionEventCreatedAt: eventCreatedAt,
    subscriptionEventOrder,
  };
}

test("newer Stripe lifecycle state cannot be reverted by a stale event", async () => {
  const store = new OrderedAccountStore();
  const service = createApiAccessService({ store, pepper, now: () => now });
  const canceled = await service.provisionSubscription(subscription("canceled", now + 2_000, 202_092));
  assert.equal(canceled.subscriptionStatus, "canceled");

  const staleResult = await service.provisionSubscription(subscription("active", now + 1_000, 201_022));
  assert.equal(staleResult.subscriptionStatus, "canceled");
  assert.equal((await store.getAccount()).subscriptionEventOrder, 202_092);
});

test("a more restrictive state wins when Stripe events share a timestamp", async () => {
  const store = new OrderedAccountStore();
  const service = createApiAccessService({ store, pepper, now: () => now });
  const active = await service.provisionSubscription(subscription("active", now + 1_000, 201_022));
  assert.equal(active.subscriptionStatus, "active");
  const canceled = await service.provisionSubscription(subscription("canceled", now + 1_000, 201_092));
  assert.equal(canceled.subscriptionStatus, "canceled");
  const delayedActive = await service.provisionSubscription(subscription("active", now + 1_000, 201_022));
  assert.equal(delayedActive.subscriptionStatus, "canceled");
});

test("equal event orders are idempotent and do not rewrite account state", async () => {
  const store = new OrderedAccountStore();
  const service = createApiAccessService({ store, pepper, now: () => now });
  await service.provisionSubscription(subscription("past_due", now + 1_000, 201_062));
  const duplicate = await service.provisionSubscription(subscription("active", now + 1_000, 201_062));
  assert.equal(duplicate.subscriptionStatus, "past_due");
});
