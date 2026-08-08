import assert from "node:assert/strict";
import test from "node:test";
import { createStripeSubscriptionGateway } from "../src/stripe-subscriptions.js";

function stripeClient(overrides = {}) {
  const calls = [];
  const stripe = {
    checkout: { sessions: { create: async () => ({}) } },
    subscriptions: {
      retrieve: async () => ({ id: "sub_1", customer: "cus_1", default_payment_method: "pm_default", items: { data: [{ id: "si_1" }] } }),
      update: async (id, params) => { calls.push(["subscription-update", id, params]); return { id, ...params }; },
    },
    customers: {
      retrieve: async () => ({ id: "cus_1", invoice_settings: { default_payment_method: "pm_default" } }),
      update: async (id, params) => { calls.push(["customer-update", id, params]); return { id, ...params }; },
    },
    invoices: { list: async () => ({ data: [] }) },
    invoicePayments: { list: async () => ({ data: [] }) },
    paymentIntents: { retrieve: async () => ({}) },
    paymentMethods: {
      retrieve: async (id) => ({
        id,
        customer: id === "pm_other_customer" ? "cus_other" : "cus_1",
        type: "card",
        card: { brand: "visa", last4: id === "pm_default" ? "1111" : "2222", exp_month: 1, exp_year: 2035 },
      }),
      list: async () => ({
        data: [
          { id: "pm_default", customer: "cus_1", type: "card", card: { brand: "visa", last4: "1111", exp_month: 1, exp_year: 2035 } },
          { id: "pm_backup", customer: "cus_1", type: "card", card: { brand: "mastercard", last4: "2222", exp_month: 2, exp_year: 2036 } },
        ],
      }),
      detach: async (id) => { calls.push(["detach", id]); return { id, customer: null }; },
    },
    setupIntents: { create: async () => ({}), retrieve: async () => ({}) },
    webhooks: { constructEvent: () => ({}) },
    ...overrides,
  };
  return { stripe, calls };
}

test("management returns the billing default and all attached saved cards", async () => {
  const { stripe } = stripeClient();
  const state = await createStripeSubscriptionGateway(stripe, "whsec_test")
    .retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(state.paymentMethod.id, "pm_default");
  assert.equal(state.defaultPaymentMethodId, "pm_default");
  assert.deepEqual(state.attachedPaymentMethods.map(({ id }) => id), ["pm_default", "pm_backup"]);
});

test("setting a default card requires ownership and updates both customer and subscription", async () => {
  const { stripe, calls } = stripeClient();
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  assert.deepEqual(
    await gateway.setDefaultPaymentMethod({ customerId: "cus_1", subscriptionId: "sub_1", paymentMethodId: "pm_backup" }),
    { applied: true, paymentMethod: await stripe.paymentMethods.retrieve("pm_backup") },
  );
  assert.deepEqual(calls, [
    ["customer-update", "cus_1", { invoice_settings: { default_payment_method: "pm_backup" } }],
    ["subscription-update", "sub_1", { default_payment_method: "pm_backup" }],
  ]);
  assert.deepEqual(
    await gateway.setDefaultPaymentMethod({ customerId: "cus_1", subscriptionId: "sub_1", paymentMethodId: "pm_other_customer" }),
    { applied: false, reason: "not_owned" },
  );
});

test("default card cannot be detached until another default is chosen", async () => {
  const { stripe, calls } = stripeClient();
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  assert.deepEqual(
    await gateway.detachPaymentMethod({ customerId: "cus_1", subscriptionId: "sub_1", paymentMethodId: "pm_default" }),
    { detached: false, reason: "default" },
  );
  assert.equal(calls.some(([type]) => type === "detach"), false);
});

test("non-default owned card can be detached and another customer's card cannot", async () => {
  const { stripe, calls } = stripeClient();
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  assert.deepEqual(
    await gateway.detachPaymentMethod({ customerId: "cus_1", subscriptionId: "sub_1", paymentMethodId: "pm_backup" }),
    { detached: true },
  );
  assert.deepEqual(calls.at(-1), ["detach", "pm_backup"]);
  assert.deepEqual(
    await gateway.detachPaymentMethod({ customerId: "cus_1", subscriptionId: "sub_1", paymentMethodId: "pm_other_customer" }),
    { detached: false, reason: "not_owned" },
  );
});
