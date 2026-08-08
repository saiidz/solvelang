import assert from "node:assert/strict";
import test from "node:test";
import { createStripeSubscriptionGateway } from "../src/stripe-subscriptions.js";

function stripeClient(calls) {
  return {
    checkout: { sessions: { create: async () => ({}) } },
    subscriptions: {
      retrieve: async (id) => ({
        id,
        customer: "cus_1",
        metadata: { accountId: "acct_1", plan: "developer" },
        items: { data: [{ id: "si_1" }] },
      }),
      update: async (id, params) => {
        calls.push({ id, params });
        return { id, ...params };
      },
    },
    customers: { retrieve: async () => ({ id: "cus_1" }), update: async () => ({}) },
    invoices: { list: async () => ({ data: [] }) },
    invoicePayments: { list: async () => ({ data: [] }) },
    paymentIntents: { retrieve: async () => ({}) },
    paymentMethods: { retrieve: async () => ({}), list: async () => ({ data: [] }) },
    setupIntents: { create: async () => ({}), retrieve: async () => ({}) },
    webhooks: { constructEvent: () => ({}) },
  };
}

test("plan change replaces the single subscription item, resumes renewal, and creates prorations", async () => {
  const calls = [];
  const gateway = createStripeSubscriptionGateway(stripeClient(calls), "whsec_test");
  await gateway.changeSubscriptionPlan({
    subscriptionId: "sub_1",
    priceId: "price_pro123",
    plan: "pro",
  });
  assert.deepEqual(calls, [{
    id: "sub_1",
    params: {
      items: [{ id: "si_1", price: "price_pro123", quantity: 1 }],
      metadata: { accountId: "acct_1", plan: "pro" },
      cancel_at_period_end: false,
      proration_behavior: "create_prorations",
    },
  }]);
});

test("plan change fails closed when Stripe subscription shape is not a single managed item", async () => {
  const stripe = stripeClient([]);
  stripe.subscriptions.retrieve = async () => ({ id: "sub_1", items: { data: [] } });
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  await assert.rejects(
    () => gateway.changeSubscriptionPlan({ subscriptionId: "sub_1", priceId: "price_pro123", plan: "pro" }),
    /exactly one managed plan item/,
  );
});
