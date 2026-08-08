import assert from "node:assert/strict";
import test from "node:test";
import { createStripeSubscriptionGateway } from "../src/stripe-subscriptions.js";

function stripeClient(overrides = {}) {
  return {
    checkout: { sessions: { create: async () => ({ id: "cs_default", client_secret: "cs_default_secret" }) } },
    subscriptions: {
      retrieve: async () => ({ id: "sub_1", customer: "cus_1", status: "active", default_payment_method: "pm_1" }),
      update: async (id, params) => ({ id, ...params }),
    },
    customers: {
      retrieve: async () => ({ id: "cus_1", invoice_settings: {} }),
      update: async (id, params) => ({ id, ...params }),
    },
    invoices: { list: async () => ({ data: [] }) },
    invoicePayments: { list: async () => ({ data: [] }) },
    paymentIntents: { retrieve: async (id) => ({ id, customer: "cus_1", payment_method: "pm_1" }) },
    paymentMethods: {
      retrieve: async (id) => ({ id, customer: "cus_1", type: "card", card: { brand: "visa", last4: "4242" } }),
      list: async () => ({ data: [] }),
      detach: async (id) => ({ id, customer: null }),
    },
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

test("prefers the subscription default card", async () => {
  const stripe = stripeClient({
    subscriptions: { retrieve: async () => ({ id: "sub_1", customer: "cus_1", default_payment_method: "pm_subscription" }), update: async () => ({}) },
    paymentMethods: {
      retrieve: async (id) => ({ id, customer: "cus_1", type: "card", card: { last4: "1111" } }),
      list: async () => ({ data: [] }),
      detach: async () => ({}),
    },
  });
  const state = await createStripeSubscriptionGateway(stripe, "whsec_test")
    .retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(state.paymentMethod.id, "pm_subscription");
  assert.equal(state.paymentMethodSource, "subscription_default");
});

test("falls back to the customer default card", async () => {
  const calls = [];
  const stripe = stripeClient({
    subscriptions: {
      retrieve: async (id) => { calls.push(["subscription", id]); return { id, customer: "cus_1", status: "active", default_payment_method: null }; },
      update: async () => ({}),
    },
    customers: {
      retrieve: async (id) => ({ id, invoice_settings: { default_payment_method: "pm_customer" } }),
      update: async () => ({}),
    },
    invoices: { list: async (params) => { calls.push(["invoices", params]); return { data: [{ id: "in_1" }] }; } },
    paymentMethods: {
      retrieve: async (id) => { calls.push(["payment", id]); return { id, customer: "cus_1", type: "card", card: { last4: "4242" } }; },
      list: async () => ({ data: [] }),
      detach: async () => ({}),
    },
  });
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  const state = await gateway.retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(state.paymentMethod.id, "pm_customer");
  assert.equal(state.paymentMethodSource, "customer_default");
  assert.equal(state.invoices.data[0].id, "in_1");
  assert.deepEqual(calls, [
    ["subscription", "sub_1"],
    ["invoices", { customer: "cus_1", limit: 12 }],
    ["payment", "pm_customer"],
  ]);
});

test("continues securely when a configured subscription default no longer exists", async () => {
  const stripe = stripeClient({
    subscriptions: { retrieve: async () => ({ id: "sub_1", customer: "cus_1", default_payment_method: "pm_missing" }), update: async () => ({}) },
    customers: { retrieve: async () => ({ id: "cus_1", invoice_settings: { default_payment_method: "pm_customer" } }), update: async () => ({}) },
    paymentMethods: {
      retrieve: async (id) => {
        if (id === "pm_missing") throw Object.assign(new Error("missing"), { code: "resource_missing" });
        return { id, customer: "cus_1", type: "card", card: { last4: "4242" } };
      },
      list: async () => ({ data: [] }),
      detach: async () => ({}),
    },
  });
  const state = await createStripeSubscriptionGateway(stripe, "whsec_test")
    .retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(state.paymentMethod.id, "pm_customer");
  assert.equal(state.paymentMethodSource, "customer_default");
});

test("falls back to the latest successfully paid invoice card", async () => {
  const stripe = stripeClient({
    subscriptions: { retrieve: async () => ({ id: "sub_1", customer: "cus_1", default_payment_method: null }), update: async () => ({}) },
    invoices: { list: async () => ({ data: [
      { id: "in_open", status: "open", amount_paid: 0, created: 20 },
      { id: "in_paid", status: "paid", amount_paid: 4900, created: 10 },
    ] }) },
    invoicePayments: { list: async (params) => {
      assert.deepEqual(params, { invoice: "in_paid", status: "paid", limit: 10 });
      return { data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_paid" } }] };
    } },
    paymentIntents: { retrieve: async () => ({ id: "pi_paid", customer: "cus_1", payment_method: "pm_paid" }) },
    paymentMethods: {
      retrieve: async () => ({ id: "pm_paid", customer: "cus_1", type: "card", card: { last4: "4242" } }),
      list: async () => ({ data: [] }),
      detach: async () => ({}),
    },
  });
  const state = await createStripeSubscriptionGateway(stripe, "whsec_test")
    .retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(state.paymentMethod.id, "pm_paid");
  assert.equal(state.paymentMethodSource, "paid_invoice");
});

test("uses one attached card but does not choose among multiple attached cards", async () => {
  const attached = (ids) => stripeClient({
    subscriptions: { retrieve: async () => ({ id: "sub_1", customer: "cus_1", default_payment_method: null }), update: async () => ({}) },
    paymentMethods: {
      retrieve: async () => { throw new Error("should not retrieve a missing default"); },
      list: async () => ({ data: ids.map((id) => ({ id, customer: "cus_1", type: "card", card: { brand: "visa", last4: id.slice(-4), exp_month: 1, exp_year: 2035 } })) }),
      detach: async () => ({}),
    },
  });
  const one = await createStripeSubscriptionGateway(attached(["pm_1111"]), "whsec_test")
    .retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(one.paymentMethod.id, "pm_1111");
  assert.equal(one.paymentMethodSource, "single_attached");

  const multiple = await createStripeSubscriptionGateway(attached(["pm_1111", "pm_2222"]), "whsec_test")
    .retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(multiple.paymentMethod, null);
  assert.deepEqual(multiple.attachedPaymentMethods.map(({ id }) => id), ["pm_1111", "pm_2222"]);
});

test("rejects a payment method owned by another customer and handles no card", async () => {
  const wrongOwner = stripeClient({
    subscriptions: { retrieve: async () => ({ id: "sub_1", customer: "cus_1", default_payment_method: "pm_other" }), update: async () => ({}) },
    paymentMethods: {
      retrieve: async () => ({ id: "pm_other", customer: "cus_other", type: "card", card: { last4: "9999" } }),
      list: async () => ({ data: [] }),
      detach: async () => ({}),
    },
  });
  const state = await createStripeSubscriptionGateway(wrongOwner, "whsec_test")
    .retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(state.paymentMethod, null);
  assert.deepEqual(state.attachedPaymentMethods, []);

  const none = await createStripeSubscriptionGateway(stripeClient({
    subscriptions: { retrieve: async () => ({ id: "sub_1", customer: "cus_1", default_payment_method: null }), update: async () => ({}) },
  }), "whsec_test").retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(none.paymentMethod, null);
});

test("normalizes the paid checkout card onto the customer and subscription", async () => {
  const calls = [];
  const stripe = stripeClient({
    invoices: { list: async () => ({ data: [{ id: "in_paid", status: "paid", amount_paid: 4900, created: 10 }] }) },
    invoicePayments: { list: async () => ({ data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_paid" } }] }) },
    paymentIntents: { retrieve: async () => ({ id: "pi_paid", customer: "cus_1", payment_method: "pm_paid" }) },
    paymentMethods: { retrieve: async () => ({ id: "pm_paid", customer: "cus_1", type: "card", card: { last4: "4242" } }), list: async () => ({ data: [] }), detach: async () => ({}) },
    customers: { retrieve: async () => ({ id: "cus_1", invoice_settings: {} }), update: async (...args) => calls.push(["customer", ...args]) },
    subscriptions: { retrieve: async () => ({ id: "sub_1", customer: "cus_1" }), update: async (...args) => calls.push(["subscription", ...args]) },
  });
  const result = await createStripeSubscriptionGateway(stripe, "whsec_test")
    .normalizeSuccessfulSubscriptionPaymentMethod({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(result, true);
  assert.deepEqual(calls, [
    ["customer", "cus_1", { invoice_settings: { default_payment_method: "pm_paid" } }],
    ["subscription", "sub_1", { default_payment_method: "pm_paid" }],
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
