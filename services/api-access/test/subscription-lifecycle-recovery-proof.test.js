import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessService } from "../src/service.js";
import { createSubscriptionLifecycleService } from "../src/subscriptions.js";

const priceIds = {
  developer: "price_dev123",
  pro: "price_pro123",
  business: "price_business123",
};

function subscriptionEvent({ id, created, status, plan = "pro" }) {
  return {
    id,
    type: "customer.subscription.updated",
    created,
    data: {
      object: {
        id: "sub_recovery_1",
        customer: "cus_recovery_1",
        status,
        metadata: { accountId: "acct_recovery_1", email: "owner@example.com" },
        items: {
          data: [{
            price: { id: priceIds[plan] },
            current_period_end: created + 30 * 24 * 60 * 60,
          }],
        },
      },
    },
  };
}

function statefulApiAccessService() {
  let account;
  const store = {
    async getAccount() {
      return account;
    },
    async putAccount(next) {
      if (account?.subscriptionEventOrder >= next.subscriptionEventOrder) return "stale";
      account = { ...next };
      return "updated";
    },
  };
  return {
    service: createApiAccessService({
      store,
      pepper: "p".repeat(32),
      now: () => 1_820_000_000_000,
    }),
    read: () => account,
  };
}

function eventStore() {
  return {
    claimEvent: async () => "claimed",
    completeEvent: async () => "completed",
    releaseEvent: async () => "released",
  };
}

function lifecycle(service, gracePeriodMs = 60_000) {
  return createSubscriptionLifecycleService({
    apiAccessService: service,
    eventStore: eventStore(),
    priceIds,
    gracePeriodMs,
    now: () => 1_820_000_000_000,
    claimToken: (() => {
      let sequence = 0;
      return () => `claim_recovery_${++sequence}`;
    })(),
  });
}

test("a later active subscription event clears past-due grace state and restores the authoritative lifecycle state", async () => {
  const fixture = statefulApiAccessService();
  const service = lifecycle(fixture.service);
  const failedAt = 1_785_254_400;

  await service.processEvent(subscriptionEvent({
    id: "evt_payment_failed_state",
    created: failedAt,
    status: "past_due",
  }));

  assert.equal(fixture.read().subscriptionStatus, "past_due");
  assert.equal(fixture.read().graceUntil, failedAt * 1_000 + 60_000);

  const recovered = await service.processEvent(subscriptionEvent({
    id: "evt_payment_recovered_state",
    created: failedAt + 1,
    status: "active",
  }));

  assert.equal(recovered.handled, true);
  assert.equal(recovered.duplicate, false);
  assert.equal(fixture.read().subscriptionStatus, "active");
  assert.equal(Object.hasOwn(fixture.read(), "graceUntil"), false);
  assert.equal(fixture.read().subscriptionEventCreatedAt, (failedAt + 1) * 1_000);
});

test("an older past-due event delivered after recovery cannot overwrite the newer active subscription state", async () => {
  const fixture = statefulApiAccessService();
  const service = lifecycle(fixture.service);
  const failedAt = 1_785_254_400;

  await service.processEvent(subscriptionEvent({
    id: "evt_recovery_newer",
    created: failedAt + 2,
    status: "active",
  }));

  const stale = await service.processEvent(subscriptionEvent({
    id: "evt_failure_older",
    created: failedAt,
    status: "past_due",
  }));

  assert.equal(stale.handled, true);
  assert.equal(stale.duplicate, false);
  assert.equal(stale.account.subscriptionStatus, "active");
  assert.equal(fixture.read().subscriptionStatus, "active");
  assert.equal(Object.hasOwn(fixture.read(), "graceUntil"), false);
  assert.equal(fixture.read().subscriptionEventCreatedAt, (failedAt + 2) * 1_000);
});
