import assert from "node:assert/strict";
import test from "node:test";
import { parseApiAccessEnvironment } from "../src/config.js";
import { createMergeGovernanceCheckoutService } from "../src/merge-governance-checkout.js";
import { createStripeSubscriptionGateway } from "../src/stripe-subscriptions.js";
import { ApiAccessError } from "../src/service.js";

const priceIds = {
  "mgov-regular-monthly": "price_mgovregmonthly",
  "mgov-regular-annual": "price_mgovregannual",
  "mgov-plus-monthly": "price_mgovplusmonthly",
  "mgov-plus-annual": "price_mgovplusannual",
};

function apiService(calls = {}) {
  return {
    reserveSubscriptionCheckout: async () => { calls.reserved = (calls.reserved ?? 0) + 1; return { duplicate: false }; },
    releaseSubscriptionCheckout: async () => { calls.released = (calls.released ?? 0) + 1; return { released: true }; },
  };
}

function gateway(overrides = {}) {
  return {
    findPromotionCode: async () => null,
    createIncompleteSubscription: async () => ({
      subscriptionId: "sub_mgov_123",
      customerId: "cus_123",
      paymentRequired: true,
      clientSecret: "pi_123_secret_test",
    }),
    ...overrides,
  };
}

function service(overrides = {}) {
  return createMergeGovernanceCheckoutService({
    gateway: gateway(),
    apiAccessService: apiService(),
    priceIds,
    enabled: true,
    logger: { error() {} },
    ...overrides,
  });
}

const baseInput = {
  accountId: "acct_1",
  requestId: "checkout_1",
  email: "Dev@Example.com",
  plan: "mgov-regular-monthly",
};

test("creates an incomplete subscription for each pack and interval with its configured price", async () => {
  for (const [plan, priceId] of Object.entries(priceIds)) {
    const seen = [];
    const checkout = service({
      gateway: gateway({
        createIncompleteSubscription: async (input) => {
          seen.push(input);
          return { subscriptionId: "sub_9", customerId: "cus_9", paymentRequired: true, clientSecret: "pi_9_secret" };
        },
      }),
    });
    const result = await checkout.createMergeGovernanceCheckout({ ...baseInput, plan });
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
      plan,
      priceId,
      quantity: 1,
      product: "merge-governance",
      customerId: undefined,
      promotionCodeId: undefined,
    });
  }
});

test("passes the seat quantity through to the gateway", async () => {
  const seen = [];
  const checkout = service({
    gateway: gateway({
      createIncompleteSubscription: async (input) => {
        seen.push(input);
        return { subscriptionId: "sub_7", customerId: "cus_7", paymentRequired: true, clientSecret: "pi_7_secret" };
      },
    }),
  });
  await checkout.createMergeGovernanceCheckout({ ...baseInput, plan: "mgov-plus-annual", quantity: 7 });
  assert.equal(seen[0].quantity, 7);
  assert.equal(seen[0].priceId, "price_mgovplusannual");
});

test("accepts the seat bounds and rejects quantities outside 1-999 before reserving", async () => {
  for (const quantity of [1, 999]) {
    const checkout = service();
    const result = await checkout.createMergeGovernanceCheckout({ ...baseInput, quantity });
    assert.equal(result.paymentRequired, true);
  }
  for (const quantity of [0, 1000, -1, 2.5, "3", Number.NaN]) {
    const calls = {};
    const checkout = service({ apiAccessService: apiService(calls) });
    await assert.rejects(
      checkout.createMergeGovernanceCheckout({ ...baseInput, quantity }),
      (error) => error instanceof ApiAccessError && error.statusCode === 400 && error.code === "invalid_merge_governance_checkout",
    );
    assert.equal(calls.reserved ?? 0, 0);
  }
});

test("rejects an unknown plan before reserving", async () => {
  const calls = {};
  const checkout = service({ apiAccessService: apiService(calls) });
  await assert.rejects(
    checkout.createMergeGovernanceCheckout({ ...baseInput, plan: "developer" }),
    (error) => error instanceof ApiAccessError && error.statusCode === 400 && error.code === "invalid_merge_governance_checkout",
  );
  assert.equal(calls.reserved ?? 0, 0);
});

test("returns a no-payment-required result when a promotion covers the full price", async () => {
  const seen = [];
  const checkout = service({
    gateway: gateway({
      findPromotionCode: async (code) => (code === "FULLCOVER" ? "promo_full" : null),
      createIncompleteSubscription: async (input) => {
        seen.push(input);
        return { subscriptionId: "sub_free", customerId: "cus_free", paymentRequired: false };
      },
    }),
  });
  const result = await checkout.createMergeGovernanceCheckout({ ...baseInput, promotionCode: "FULLCOVER" });
  assert.deepEqual(result, { subscriptionId: "sub_free", customerId: "cus_free", paymentRequired: false });
  assert.equal(seen[0].promotionCodeId, "promo_full");
});

test("rejects an unknown promotion code before reserving", async () => {
  const calls = {};
  const checkout = service({ apiAccessService: apiService(calls) });
  await assert.rejects(
    checkout.createMergeGovernanceCheckout({ ...baseInput, promotionCode: "NOPE" }),
    (error) => error instanceof ApiAccessError && error.statusCode === 400 && error.code === "promotion_code_invalid",
  );
  assert.equal(calls.reserved ?? 0, 0);
});

test("fails closed when disabled or the plan price is not configured", async () => {
  const disabled = service({ enabled: false });
  await assert.rejects(
    disabled.createMergeGovernanceCheckout(baseInput),
    (error) => error instanceof ApiAccessError && error.statusCode === 503 && error.code === "merge_governance_checkout_disabled",
  );
  const unpriced = service({ priceIds: { ...priceIds, "mgov-plus-monthly": undefined } });
  await assert.rejects(
    unpriced.createMergeGovernanceCheckout({ ...baseInput, plan: "mgov-plus-monthly" }),
    (error) => error instanceof ApiAccessError && error.statusCode === 503 && error.code === "merge_governance_price_unavailable",
  );
});

test("releases the reservation when the gateway fails", async () => {
  const calls = {};
  const checkout = service({
    apiAccessService: apiService(calls),
    gateway: gateway({
      createIncompleteSubscription: async () => { throw new Error("stripe down"); },
    }),
  });
  await assert.rejects(checkout.createMergeGovernanceCheckout(baseInput), /stripe down/);
  assert.equal(calls.reserved, 1);
  assert.equal(calls.released, 1);
});

function stripeStub(captured) {
  return {
    checkout: { sessions: { create: async () => ({}) } },
    subscriptions: {
      create: async (params, options) => {
        captured.push({ params, options });
        return {
          id: "sub_mgov_gateway",
          latest_invoice: {
            payment_intent: { client_secret: "pi_gateway_secret" },
            amount_due: 10_000,
            status: "open",
          },
        };
      },
      retrieve: async () => ({}),
      update: async () => ({}),
    },
    customers: {
      create: async () => ({ id: "cus_gateway" }),
      retrieve: async () => ({}),
      update: async () => ({}),
    },
    invoices: { list: async () => ({ data: [] }) },
    invoicePayments: { list: async () => ({ data: [] }) },
    paymentIntents: { retrieve: async () => ({}) },
    paymentMethods: { list: async () => ({ data: [] }), retrieve: async () => ({}), detach: async () => ({}) },
    setupIntents: { create: async () => ({}), retrieve: async () => ({}) },
    promotionCodes: { list: async () => ({ data: [] }) },
    webhooks: { constructEvent: () => ({}) },
  };
}

test("gateway sends the seat quantity and product marker to Stripe", async () => {
  const captured = [];
  const stripeGateway = createStripeSubscriptionGateway(stripeStub(captured), "whsec_test");
  const result = await stripeGateway.createIncompleteSubscription({
    accountId: "acct_1",
    requestId: "checkout_1",
    email: "dev@example.com",
    plan: "mgov-plus-monthly",
    priceId: "price_mgovplusmonthly",
    quantity: 5,
    product: "merge-governance",
  });
  assert.equal(result.subscriptionId, "sub_mgov_gateway");
  assert.equal(result.paymentRequired, true);
  assert.deepEqual(captured[0].params.items, [{ price: "price_mgovplusmonthly", quantity: 5 }]);
  assert.equal(captured[0].params.metadata.product, "merge-governance");
  assert.equal(captured[0].params.metadata.plan, "mgov-plus-monthly");
});

test("gateway keeps the API-plan payload unchanged when quantity and product are absent", async () => {
  const captured = [];
  const stripeGateway = createStripeSubscriptionGateway(stripeStub(captured), "whsec_test");
  await stripeGateway.createIncompleteSubscription({
    accountId: "acct_1",
    requestId: "checkout_2",
    email: "dev@example.com",
    plan: "pro",
    priceId: "price_pro123",
    customerId: "cus_existing",
  });
  assert.deepEqual(captured[0].params.items, [{ price: "price_pro123" }]);
  assert.deepEqual(captured[0].params.metadata, {
    accountId: "acct_1",
    email: "dev@example.com",
    plan: "pro",
    requestId: "checkout_2",
  });
});

const configBase = {
  API_ACCESS_ENABLED: "true",
  API_ACCESS_MODE: "test",
  API_KEY_PEPPER: "p".repeat(64),
  API_ACCESS_ADMIN_SECRET: "a".repeat(64),
  SITE_ORIGIN: "https://www.solve-lang.com",
  API_ACCOUNTS_TABLE: "accounts",
  API_KEYS_TABLE: "keys",
  API_USAGE_TABLE: "usage",
  API_USAGE_IDEMPOTENCY_TABLE: "idempotency",
  API_SUBSCRIPTION_EVENTS_TABLE: "events",
};

test("config leaves Merge Governance prices undefined until they are configured", () => {
  const parsed = parseApiAccessEnvironment(configBase);
  assert.deepEqual(parsed.mergeGovernancePriceIds, {
    "mgov-regular-monthly": undefined,
    "mgov-regular-annual": undefined,
    "mgov-plus-monthly": undefined,
    "mgov-plus-annual": undefined,
  });
});

test("config binds Merge Governance price IDs from the environment", () => {
  const parsed = parseApiAccessEnvironment({
    ...configBase,
    STRIPE_MGOV_REGULAR_MONTHLY_PRICE_ID: "price_1UZGDH4HWc7PvaDYJ1W9Rlxh",
    STRIPE_MGOV_REGULAR_ANNUAL_PRICE_ID: "price_1UZGDH4HWc7PvaDY5j7uMC3s",
    STRIPE_MGOV_PLUS_MONTHLY_PRICE_ID: "price_1UZGDN4HWc7PvaDYD9evdkxz",
    STRIPE_MGOV_PLUS_ANNUAL_PRICE_ID: "price_1UZGDN4HWc7PvaDYK42zx1LY",
  });
  assert.deepEqual(parsed.mergeGovernancePriceIds, {
    "mgov-regular-monthly": "price_1UZGDH4HWc7PvaDYJ1W9Rlxh",
    "mgov-regular-annual": "price_1UZGDH4HWc7PvaDY5j7uMC3s",
    "mgov-plus-monthly": "price_1UZGDN4HWc7PvaDYD9evdkxz",
    "mgov-plus-annual": "price_1UZGDN4HWc7PvaDYK42zx1LY",
  });
});
