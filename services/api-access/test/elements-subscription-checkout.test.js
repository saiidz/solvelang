import assert from "node:assert/strict";
import test from "node:test";
import { createElementsSubscriptionCheckoutService } from "../src/elements-subscription-checkout.js";
import { ApiAccessError } from "../src/service.js";

const priceIds = {
  developer: "price_dev123",
  pro: "price_pro123",
  business: "price_business123",
};

function apiService(existing, calls = {}) {
  return {
    getSubscriptionAccount: async () => existing,
    reserveSubscriptionCheckout: async () => { calls.reserved = (calls.reserved ?? 0) + 1; return { duplicate: false }; },
    releaseSubscriptionCheckout: async () => { calls.released = (calls.released ?? 0) + 1; return { released: true }; },
  };
}

function gateway(overrides = {}) {
  return {
    findPromotionCode: async () => null,
    createIncompleteSubscription: async () => ({
      subscriptionId: "sub_123",
      customerId: "cus_123",
      paymentRequired: true,
      clientSecret: "pi_123_secret_test",
    }),
    ...overrides,
  };
}

test("creates an incomplete subscription and returns the PaymentIntent client secret", async () => {
  const seen = [];
  const service = createElementsSubscriptionCheckoutService({
    gateway: gateway({
      createIncompleteSubscription: async (input) => {
        seen.push(input);
        return { subscriptionId: "sub_9", customerId: "cus_9", paymentRequired: true, clientSecret: "pi_9_secret" };
      },
    }),
    apiAccessService: apiService(),
    priceIds,
    enabled: true,
  });

  const result = await service.createElementsCheckout({
    accountId: "acct_1",
    requestId: "checkout_1",
    email: "Dev@Example.com",
    plan: "pro",
  });

  assert.deepEqual(result, {
    subscriptionId: "sub_9",
    customerId: "cus_9",
    paymentRequired: true,
    clientSecret: "pi_9_secret",
  });
  assert.deepEqual(seen[0], {
    accountId: "acct_1",
    requestId: "checkout_1",
    email: "dev@example.com",
    plan: "pro",
    priceId: "price_pro123",
    customerId: undefined,
    promotionCodeId: undefined,
  });
});

test("returns a no-payment-required result when a promotion code covers the full price", async () => {
  const service = createElementsSubscriptionCheckoutService({
    gateway: gateway({
      findPromotionCode: async (code) => (code === "SOLVELANGCANARY" ? "promo_1" : null),
      createIncompleteSubscription: async (input) => {
        assert.equal(input.promotionCodeId, "promo_1");
        return { subscriptionId: "sub_free", customerId: "cus_free", paymentRequired: false };
      },
    }),
    apiAccessService: apiService(),
    priceIds,
    enabled: true,
  });

  const result = await service.createElementsCheckout({
    accountId: "acct_2",
    requestId: "checkout_2",
    email: "free@example.com",
    plan: "developer",
    promotionCode: "SOLVELANGCANARY",
  });

  assert.deepEqual(result, { subscriptionId: "sub_free", customerId: "cus_free", paymentRequired: false });
  assert.equal("clientSecret" in result, false);
});

test("rejects an unknown promotion code before reserving", async () => {
  const calls = {};
  const service = createElementsSubscriptionCheckoutService({
    gateway: gateway({ findPromotionCode: async () => null }),
    apiAccessService: apiService(undefined, calls),
    priceIds,
    enabled: true,
  });

  await assert.rejects(
    service.createElementsCheckout({
      accountId: "acct_3",
      requestId: "checkout_3",
      email: "bad-code@example.com",
      plan: "developer",
      promotionCode: "NOPE",
    }),
    (error) => error instanceof ApiAccessError && error.code === "promotion_code_invalid" && error.statusCode === 400,
  );
  assert.equal(calls.reserved ?? 0, 0);
});

test("fails closed when disabled or a live subscription exists, and releases the reservation on gateway failure", async () => {
  const disabled = createElementsSubscriptionCheckoutService({
    gateway: gateway(),
    apiAccessService: apiService(),
    priceIds,
    enabled: false,
  });
  await assert.rejects(
    disabled.createElementsCheckout({ accountId: "a", requestId: "r", email: "x@example.com", plan: "pro" }),
    (error) => error.code === "subscription_checkout_disabled",
  );

  const existing = createElementsSubscriptionCheckoutService({
    gateway: gateway(),
    apiAccessService: apiService({ stripeSubscriptionId: "sub_live", subscriptionStatus: "active" }),
    priceIds,
    enabled: true,
  });
  await assert.rejects(
    existing.createElementsCheckout({ accountId: "a", requestId: "r", email: "x@example.com", plan: "pro" }),
    (error) => error.code === "subscription_already_exists" && error.statusCode === 409,
  );

  const calls = {};
  const failing = createElementsSubscriptionCheckoutService({
    gateway: gateway({
      createIncompleteSubscription: async () => { throw new Error("stripe down"); },
    }),
    apiAccessService: apiService(undefined, calls),
    priceIds,
    enabled: true,
    logger: { error: () => {} },
  });
  await assert.rejects(
    failing.createElementsCheckout({ accountId: "a", requestId: "r", email: "x@example.com", plan: "pro" }),
    /stripe down/,
  );
  assert.equal(calls.reserved, 1);
  assert.equal(calls.released, 1);
});
