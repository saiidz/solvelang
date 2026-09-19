import assert from "node:assert/strict";
import test from "node:test";
import { createEmbeddedSubscriptionCheckoutService } from "../src/embedded-subscription-checkout.js";
import { ApiAccessError } from "../src/service.js";

const priceIds = {
  developer: "price_dev123",
  pro: "price_pro123",
  business: "price_business123",
};

function apiService(existing) {
  return {
    getSubscriptionAccount: async () => existing,
    reserveSubscriptionCheckout: async () => ({ duplicate: false }),
    releaseSubscriptionCheckout: async () => ({ released: true }),
  };
}

test("creates an embedded session and returns only the client secret needed by Stripe.js", async () => {
  const calls = [];
  const service = createEmbeddedSubscriptionCheckoutService({
    gateway: {
      createCheckoutSession: async (input) => {
        calls.push(input);
        return { id: "cs_test_1", client_secret: "cs_test_1_secret_test" };
      },
    },
    apiAccessService: apiService(),
    priceIds,
    siteOrigin: "https://www.solve-lang.com",
    enabled: true,
  });

  const result = await service.createCheckout({
    accountId: "acct_1",
    requestId: "checkout_1",
    email: "Dev@Example.com",
    plan: "pro",
  });

  assert.deepEqual(result, { sessionId: "cs_test_1", clientSecret: "cs_test_1_secret_test" });
  assert.deepEqual(calls[0], {
    accountId: "acct_1",
    requestId: "checkout_1",
    email: "dev@example.com",
    plan: "pro",
    priceId: "price_pro123",
    customerId: undefined,
    returnUrl: "https://www.solve-lang.com/account/api-keys/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
  });
});

test("fails closed when billing is disabled, a subscription exists, or Stripe omits the client secret", async () => {
  const disabled = createEmbeddedSubscriptionCheckoutService({
    gateway: { createCheckoutSession: async () => ({}) },
    apiAccessService: apiService(),
    priceIds,
    siteOrigin: "https://www.solve-lang.com",
    enabled: false,
  });
  await assert.rejects(
    () => disabled.createCheckout({ accountId: "acct_1", requestId: "checkout_1", email: "dev@example.com", plan: "developer" }),
    (error) => error instanceof ApiAccessError && error.code === "subscription_checkout_disabled",
  );

  const existing = createEmbeddedSubscriptionCheckoutService({
    gateway: { createCheckoutSession: async () => ({}) },
    apiAccessService: apiService({ stripeSubscriptionId: "sub_1", subscriptionStatus: "active" }),
    priceIds,
    siteOrigin: "https://www.solve-lang.com",
    enabled: true,
  });
  await assert.rejects(
    () => existing.createCheckout({ accountId: "acct_1", requestId: "checkout_2", email: "dev@example.com", plan: "developer" }),
    (error) => error instanceof ApiAccessError && error.code === "subscription_already_exists",
  );

  const unavailable = createEmbeddedSubscriptionCheckoutService({
    gateway: { createCheckoutSession: async () => ({ id: "cs_test_1" }) },
    apiAccessService: apiService(),
    priceIds,
    siteOrigin: "https://www.solve-lang.com",
    enabled: true,
  });
  await assert.rejects(
    () => unavailable.createCheckout({ accountId: "acct_1", requestId: "checkout_3", email: "dev@example.com", plan: "developer" }),
    (error) => error instanceof ApiAccessError && error.code === "stripe_checkout_unavailable",
  );
});


test("releases the checkout reservation when Stripe session creation fails so retry is not stranded", async () => {
  const calls = [];
  const apiAccessService = {
    getSubscriptionAccount: async () => undefined,
    reserveSubscriptionCheckout: async (input) => { calls.push(["reserve", input]); return { duplicate: false }; },
    releaseSubscriptionCheckout: async (input) => { calls.push(["release", input]); return { released: true }; },
  };
  const service = createEmbeddedSubscriptionCheckoutService({
    gateway: { createCheckoutSession: async () => { throw new Error("stripe unavailable"); } },
    apiAccessService,
    priceIds,
    siteOrigin: "https://www.solve-lang.com",
    enabled: true,
  });
  await assert.rejects(
    () => service.createCheckout({ accountId: "acct_1", requestId: "checkout_retry", email: "dev@example.com", plan: "developer" }),
    /stripe unavailable/,
  );
  assert.deepEqual(calls.map(([kind]) => kind), ["reserve", "release"]);
  assert.equal(calls[1][1].requestId, "checkout_retry");
});
