import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessService } from "../src/service.js";

const pepper = "p".repeat(64);
const now = Date.UTC(2026, 6, 28, 12, 0, 0);

class OrderedAccountStore {
  account;

  async putAccount(next) {
    if (this.account && this.account.subscriptionEventCreatedAt > next.subscriptionEventCreatedAt) return "stale";
    this.account = { ...this.account, ...structuredClone(next), activeKeyCount: this.account?.activeKeyCount ?? 0 };
    return "updated";
  }

  async getAccount() { return structuredClone(this.account); }
}

function subscription(status, eventCreatedAt) {
  return {
    accountId: "acct_1",
    email: "dev@example.com",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    plan: "pro",
    subscriptionStatus: status,
    currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1_000,
    subscriptionEventCreatedAt: eventCreatedAt,
  };
}

test("newer Stripe lifecycle state cannot be reverted by a stale event", async () => {
  const store = new OrderedAccountStore();
  const service = createApiAccessService({ store, pepper, now: () => now });
  const canceled = await service.provisionSubscription(subscription("canceled", now + 2_000));
  assert.equal(canceled.subscriptionStatus, "canceled");

  const staleResult = await service.provisionSubscription(subscription("active", now + 1_000));
  assert.equal(staleResult.subscriptionStatus, "canceled");
  assert.equal((await store.getAccount()).subscriptionEventCreatedAt, now + 2_000);
});

test("equal or newer event timestamps update subscription state", async () => {
  const store = new OrderedAccountStore();
  const service = createApiAccessService({ store, pepper, now: () => now });
  await service.provisionSubscription(subscription("past_due", now + 1_000));
  const active = await service.provisionSubscription(subscription("active", now + 1_000));
  assert.equal(active.subscriptionStatus, "active");
  const canceled = await service.provisionSubscription(subscription("canceled", now + 2_000));
  assert.equal(canceled.subscriptionStatus, "canceled");
});
