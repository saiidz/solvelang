import assert from "node:assert/strict";
import test from "node:test";
import { ApiAccessError } from "../src/service.js";
import { createSubscriptionCheckoutService, createSubscriptionLifecycleService } from "../src/subscriptions.js";

const priceIds = {
  developer: "price_dev123",
  pro: "price_pro123",
  business: "price_business123",
};

function stripeEvent(overrides = {}) {
  return {
    id: "evt_1",
    type: "customer.subscription.updated",
    created: 1_785_254_400,
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        metadata: { accountId: "acct_1", email: "dev@example.com" },
        items: { data: [{ price: { id: "price_pro123" }, current_period_end: 1_787_846_400 }] },
      },
    },
    ...overrides,
  };
}

function lifecycleApiService({ existing, provision } = {}) {
  return {
    getSubscriptionAccount: async () => existing,
    provisionSubscription: provision ?? (async (input) => input),
  };
}

test("subscription Checkout stays disabled and uses unique request IDs when enabled", async () => {
  const calls = [];
  const gateway = {
    createCheckoutSession: async (input) => {
      calls.push(input);
      return { id: "cs_test_1", url: "https://checkout.stripe.test/session" };
    },
  };
  const apiAccessService = lifecycleApiService();
  const disabled = createSubscriptionCheckoutService({ gateway, apiAccessService, priceIds, siteOrigin: "https://www.solve-lang.com", enabled: false });
  await assert.rejects(() => disabled.createCheckout({ accountId: "acct_1", requestId: "request_1", email: "dev@example.com", plan: "pro" }), (error) => error instanceof ApiAccessError && error.code === "subscription_checkout_disabled");

  const enabled = createSubscriptionCheckoutService({ gateway, apiAccessService, priceIds, siteOrigin: "https://www.solve-lang.com", enabled: true });
  const result = await enabled.createCheckout({ accountId: "acct_1", requestId: "request_1", email: "Dev@example.com", plan: "pro" });
  assert.deepEqual(result, { sessionId: "cs_test_1", url: "https://checkout.stripe.test/session" });
  assert.deepEqual(calls[0], {
    accountId: "acct_1",
    requestId: "request_1",
    email: "dev@example.com",
    plan: "pro",
    priceId: "price_pro123",
    customerId: undefined,
    successUrl: "https://www.solve-lang.com/account/api-keys/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://www.solve-lang.com/api-pricing/?checkout=canceled",
  });
});

test("Checkout rejects a second active or pending subscription but allows replacement after cancellation", async () => {
  const gateway = { createCheckoutSession: async () => ({ id: "cs_test_1", url: "https://checkout.stripe.test/session" }) };
  const active = createSubscriptionCheckoutService({
    gateway,
    apiAccessService: lifecycleApiService({ existing: { stripeSubscriptionId: "sub_existing", subscriptionStatus: "active" } }),
    priceIds,
    siteOrigin: "https://www.solve-lang.com",
    enabled: true,
  });
  await assert.rejects(
    () => active.createCheckout({ accountId: "acct_1", requestId: "request_2", email: "dev@example.com", plan: "pro" }),
    (error) => error instanceof ApiAccessError && error.code === "subscription_already_exists",
  );

  const canceled = createSubscriptionCheckoutService({
    gateway,
    apiAccessService: lifecycleApiService({ existing: { stripeSubscriptionId: "sub_old", subscriptionStatus: "canceled" } }),
    priceIds,
    siteOrigin: "https://www.solve-lang.com",
    enabled: true,
  });
  assert.equal((await canceled.createCheckout({ accountId: "acct_1", requestId: "request_3", email: "dev@example.com", plan: "developer" })).sessionId, "cs_test_1");
});

test("maps signed subscription item periods into deterministic API account order", async () => {
  const provisioned = [];
  const events = [];
  const lifecycle = createSubscriptionLifecycleService({
    apiAccessService: lifecycleApiService({ provision: async (input) => { provisioned.push(input); return input; } }),
    eventStore: { putEventIfAbsent: async (input) => { events.push(input); return "created"; } },
    priceIds,
  });
  const event = stripeEvent();
  const result = await lifecycle.processEvent(event);
  assert.equal(result.handled, true);
  assert.equal(result.duplicate, false);
  assert.deepEqual(provisioned[0], {
    accountId: "acct_1",
    email: "dev@example.com",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    plan: "pro",
    subscriptionStatus: "active",
    currentPeriodEnd: 1_787_846_400_000,
    subscriptionEventCreatedAt: event.created * 1_000,
    subscriptionEventOrder: event.created * 1_000 + 22,
  });
  assert.equal(events[0].eventId, "evt_1");
  assert.equal(events[0].accountId, "acct_1");
});

test("uses the Stripe event timestamp for a bounded past-due grace period", async () => {
  let account;
  const lifecycle = createSubscriptionLifecycleService({
    apiAccessService: lifecycleApiService({ provision: async (input) => { account = input; return input; } }),
    eventStore: { putEventIfAbsent: async () => "created" },
    priceIds,
    gracePeriodMs: 60_000,
  });
  const event = stripeEvent();
  event.data.object.status = "past_due";
  await lifecycle.processEvent(event);
  assert.equal(account.subscriptionStatus, "past_due");
  assert.equal(account.graceUntil, event.created * 1_000 + 60_000);
  assert.equal(account.subscriptionEventCreatedAt, event.created * 1_000);
  assert.equal(account.subscriptionEventOrder, event.created * 1_000 + 62);
});

test("subscription deletion cancels access and duplicate delivery remains idempotent", async () => {
  let account;
  const lifecycle = createSubscriptionLifecycleService({
    apiAccessService: lifecycleApiService({ provision: async (input) => { account = input; return input; } }),
    eventStore: { putEventIfAbsent: async () => "duplicate" },
    priceIds,
  });
  const event = stripeEvent({ type: "customer.subscription.deleted" });
  event.data.object.status = "active";
  const result = await lifecycle.processEvent(event);
  assert.equal(account.subscriptionStatus, "canceled");
  assert.equal(account.subscriptionEventOrder, event.created * 1_000 + 92);
  assert.equal(result.duplicate, true);
});

test("events from a second or obsolete subscription cannot replace the current subscription", async () => {
  const existing = {
    accountId: "acct_1",
    stripeSubscriptionId: "sub_current",
    subscriptionStatus: "active",
    plan: "pro",
  };
  let provisioned = false;
  const stored = [];
  const lifecycle = createSubscriptionLifecycleService({
    apiAccessService: lifecycleApiService({ existing, provision: async () => { provisioned = true; } }),
    eventStore: { putEventIfAbsent: async (record) => { stored.push(record); return "created"; } },
    priceIds,
  });
  const second = stripeEvent();
  second.data.object.id = "sub_second";
  const result = await lifecycle.processEvent(second);
  assert.equal(result.ignored, "subscription_conflict");
  assert.equal(result.account, existing);
  assert.equal(provisioned, false);
  assert.equal(stored[0].subscriptionId, "sub_second");
});

test("a canceled subscription cannot be restored by a later active event for the same subscription", async () => {
  const existing = { accountId: "acct_1", stripeSubscriptionId: "sub_1", subscriptionStatus: "canceled" };
  const lifecycle = createSubscriptionLifecycleService({
    apiAccessService: lifecycleApiService({ existing, provision: async () => { throw new Error("should not restore"); } }),
    eventStore: { putEventIfAbsent: async () => "created" },
    priceIds,
  });
  const result = await lifecycle.processEvent(stripeEvent());
  assert.equal(result.ignored, "subscription_conflict");
  assert.equal(result.account, existing);
});

test("ignores unrelated Stripe events and rejects unknown prices, malformed metadata, or missing item periods", async () => {
  const lifecycle = createSubscriptionLifecycleService({
    apiAccessService: lifecycleApiService({ provision: async () => { throw new Error("should not run"); } }),
    eventStore: { putEventIfAbsent: async () => "created" },
    priceIds,
  });
  assert.deepEqual(await lifecycle.processEvent({ id: "evt_ignore", type: "invoice.paid", created: 1, data: { object: {} } }), { handled: false, duplicate: false });

  const unknown = stripeEvent();
  unknown.data.object.items.data[0].price.id = "price_unknown";
  await assert.rejects(() => lifecycle.processEvent(unknown), (error) => error instanceof ApiAccessError && error.code === "unknown_subscription_price");

  const malformed = stripeEvent();
  delete malformed.data.object.metadata.accountId;
  await assert.rejects(() => lifecycle.processEvent(malformed), (error) => error instanceof ApiAccessError && error.code === "invalid_subscription_event");

  const noPeriod = stripeEvent();
  delete noPeriod.data.object.items.data[0].current_period_end;
  await assert.rejects(() => lifecycle.processEvent(noPeriod), (error) => error instanceof ApiAccessError && error.code === "invalid_subscription_period");
});
