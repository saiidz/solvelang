import assert from "node:assert/strict";
import test from "node:test";
import { createStripeSubscriptionGateway } from "../src/stripe-subscriptions.js";

function stripeClient({ paymentIntentCustomer = "cus_1", paymentMethodCustomer = null } = {}) {
  return {
    checkout: { sessions: { create: async () => ({}) } },
    subscriptions: {
      retrieve: async () => ({ id: "sub_1", customer: "cus_1", default_payment_method: null }),
      update: async () => ({}),
    },
    customers: {
      retrieve: async () => ({ id: "cus_1", invoice_settings: {} }),
      update: async () => ({}),
    },
    invoices: {
      list: async () => ({ data: [{ id: "in_paid", status: "paid", amount_paid: 53356, created: 20 }] }),
    },
    invoicePayments: {
      list: async () => ({
        data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_paid" } }],
      }),
    },
    paymentIntents: {
      retrieve: async () => ({ id: "pi_paid", customer: paymentIntentCustomer, payment_method: "pm_paid" }),
    },
    paymentMethods: {
      retrieve: async () => ({
        id: "pm_paid",
        customer: paymentMethodCustomer,
        type: "card",
        card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2034 },
      }),
      list: async () => ({ data: [] }),
    },
    setupIntents: { create: async () => ({}), retrieve: async () => ({}) },
    webhooks: { constructEvent: () => ({}) },
  };
}

test("shows a card used by a paid customer-owned PaymentIntent even when the PaymentMethod is not attached", async () => {
  const gateway = createStripeSubscriptionGateway(stripeClient(), "whsec_test");
  const state = await gateway.retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(state.paymentMethodSource, "paid_invoice");
  assert.equal(state.paymentMethod.id, "pm_paid");
  assert.equal(state.paymentMethod.card.last4, "4242");
});

test("does not trust a detached card when the paid PaymentIntent belongs to another customer", async () => {
  const gateway = createStripeSubscriptionGateway(
    stripeClient({ paymentIntentCustomer: "cus_attacker" }),
    "whsec_test",
  );
  const state = await gateway.retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(state.paymentMethod, null);
  assert.deepEqual(state.attachedPaymentMethods, []);
});
