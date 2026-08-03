import assert from "node:assert/strict";
import test from "node:test";
import { createStripeSubscriptionGateway } from "../src/stripe-subscriptions.js";

function stripeClient(overrides = {}) {
  return {
    checkout: { sessions: { create: async () => ({ id: "cs_default", client_secret: "cs_default_secret" }) } },
    subscriptions: {
      retrieve: async () => ({ id: "sub_1", status: "active", default_payment_method: "pm_1" }),
      update: async (id, params) => ({ id, ...params }),
    },
    customers: {
      retrieve: async () => ({ id: "cus_1", invoice_settings: {} }),
      update: async (id, params) => ({ id, ...params }),
    },
    invoices: { list: async () => ({ data: [] }) },
    paymentMethods: { retrieve: async (id) => ({ id, card: { brand: "visa", last4: "4242" } }) },
    setupIntents: {
      create: async () => ({ id: "seti_1", client_secret: "seti_1_secret_test" }),
      retrieve: async () => ({ id: "seti_1", status: "succeeded", customer: "cus_1", payment_method: "pm_1" }),
    },
    webhooks: { constructEvent() {} },
    ...overrides,
  };
}

test("creates embedded subscription Checkout with server-owned metadata and request idempotency", async () => {
  const calls = [];
  const stripe = stripeClient({
    checkout: {
      sessions: {
        create: async (params, options) => {
          calls.push({ params, options });
          return { id: "cs_test_1", client_secret: "cs_test_1_secret_test" };
        },
      },
    },
  });
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  const result = await gateway.createCheckoutSession({
    accountId: "acct_1",
    requestId: "request_1",
    email: "dev@example.com",
    plan: "pro",
    priceId: "price_pro123",
    returnUrl: "https://www.solve-lang.com/account/api-keys/",
  });
  assert.equal(result.id, "cs_test_1");
  assert.deepEqual(calls[0], {
    params: {
      mode: "subscription",
      ui_mode: "embedded",
      redirect_on_completion: "if_required",
      client_reference_id: "acct_1",
      customer_email: "dev@example.com",
      line_items: [{ price: "price_pro123", quantity: 1 }],
      return_url: "https://www.solve-lang.com/account/api-keys/",
      metadata: { accountId: "acct_1", plan: "pro", requestId: "request_1" },
      subscription_data: { metadata: { accountId: "acct_1", email: "dev@example.com", plan: "pro" } },
    },
    options: { idempotencyKey: "api-subscription-checkout-request_1" },
  });
});

test("uses an existing Stripe customer instead of accepting a second email source", async () => {
  let params;
  const stripe = stripeClient({
    checkout: { sessions: { create: async (input) => { params = input; return { id: "cs_test_2", client_secret: "cs_test_2_secret_test" }; } } },
  });
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  await gateway.createCheckoutSession({
    accountId: "acct_1",
    requestId: "request_2",
    email: "dev@example.com",
    plan: "developer",
    priceId: "price_dev123",
    customerId: "cus_1",
    returnUrl: "https://www.solve-lang.com/account/api-keys/",
  });
  assert.equal(params.customer, "cus_1");
  assert.equal(params.customer_email, undefined);
});

test("retrieves sanitized management sources and falls back to the customer default card", async () => {
  const calls = [];
  const stripe = stripeClient({
    subscriptions: {
      retrieve: async (id) => { calls.push(["subscription", id]); return { id, status: "active", default_payment_method: null }; },
      update: async () => ({}),
    },
    customers: {
      retrieve: async (id) => ({ id, invoice_settings: { default_payment_method: "pm_customer" } }),
      update: async () => ({}),
    },
    invoices: { list: async (params) => { calls.push(["invoices", params]); return { data: [{ id: "in_1" }] }; } },
    paymentMethods: { retrieve: async (id) => { calls.push(["payment", id]); return { id, card: { last4: "4242" } }; } },
  });
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  const state = await gateway.retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(state.paymentMethod.id, "pm_customer");
  assert.equal(state.invoices.data[0].id, "in_1");
  assert.deepEqual(calls, [
    ["subscription", "sub_1"],
    ["invoices", { customer: "cus_1", limit: 12 }],
    ["payment", "pm_customer"],
  ]);
});

test("creates and completes payment-method setup with server-owned customer and subscription IDs", async () => {
  const calls = [];
  const stripe = stripeClient({
    setupIntents: {
      create: async (params) => { calls.push(["setup-create", params]); return { id: "seti_1", client_secret: "secret" }; },
      retrieve: async (id) => { calls.push(["setup-retrieve", id]); return { id, status: "succeeded" }; },
    },
    customers: {
      retrieve: async () => ({ id: "cus_1", invoice_settings: {} }),
      update: async (id, params) => { calls.push(["customer-update", id, params]); },
    },
    subscriptions: {
      retrieve: async () => ({ id: "sub_1" }),
      update: async (id, params) => { calls.push(["subscription-update", id, params]); return { id, ...params }; },
    },
  });
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  await gateway.createPaymentMethodSetup({ accountId: "acct_1", customerId: "cus_1" });
  await gateway.retrievePaymentMethodSetup({ setupIntentId: "seti_1" });
  await gateway.setDefaultPaymentMethod({ customerId: "cus_1", subscriptionId: "sub_1", paymentMethodId: "pm_1" });
  await gateway.setCancelAtPeriodEnd({ subscriptionId: "sub_1", cancelAtPeriodEnd: true });
  assert.deepEqual(calls, [
    ["setup-create", {
      customer: "cus_1",
      usage: "off_session",
      payment_method_types: ["card"],
      metadata: { accountId: "acct_1", purpose: "api_subscription_payment_method" },
    }],
    ["setup-retrieve", "seti_1"],
    ["customer-update", "cus_1", { invoice_settings: { default_payment_method: "pm_1" } }],
    ["subscription-update", "sub_1", { default_payment_method: "pm_1" }],
    ["subscription-update", "sub_1", { cancel_at_period_end: true }],
  ]);
});

test("passes raw webhook bytes and signature to Stripe verification", () => {
  const calls = [];
  const stripe = stripeClient({
    webhooks: {
      constructEvent(rawBody, signature, secret) {
        calls.push({ rawBody: rawBody.toString("utf8"), signature, secret });
        return { id: "evt_1" };
      },
    },
  });
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  assert.deepEqual(gateway.constructWebhookEvent(Buffer.from("raw"), "sig"), { id: "evt_1" });
  assert.deepEqual(calls, [{ rawBody: "raw", signature: "sig", secret: "whsec_test" }]);
});
