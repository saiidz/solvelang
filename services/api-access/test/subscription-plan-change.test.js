import assert from "node:assert/strict";
import test from "node:test";
import { createStripeSubscriptionGateway } from "../src/stripe-subscriptions.js";

function stripeClient(calls, updateImplementation) {
  return {
    checkout: { sessions: { create: async () => ({}) } },
    subscriptions: {
      retrieve: async (id) => ({
        id,
        customer: "cus_1",
        metadata: { accountId: "acct_1", email: "dev@example.com", plan: "developer" },
        items: { data: [{ id: "si_1" }] },
      }),
      update: async (id, params) => {
        calls.push({ id, params });
        if (updateImplementation) return updateImplementation(id, params, calls.length);
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

test("upgrade invoices prorations immediately and only finalizes metadata after payment applies", async () => {
  const calls = [];
  const gateway = createStripeSubscriptionGateway(stripeClient(calls), "whsec_test");
  const result = await gateway.changeSubscriptionPlan({
    subscriptionId: "sub_1",
    priceId: "price_pro123",
    plan: "pro",
    upgrade: true,
  });
  assert.equal(result.applied, true);
  assert.deepEqual(calls, [
    {
      id: "sub_1",
      params: {
        items: [{ id: "si_1", price: "price_pro123", quantity: 1 }],
        proration_behavior: "always_invoice",
        payment_behavior: "pending_if_incomplete",
      },
    },
    {
      id: "sub_1",
      params: {
        metadata: { accountId: "acct_1", email: "dev@example.com", plan: "pro" },
        cancel_at_period_end: false,
      },
    },
  ]);
});

test("upgrade payment failure leaves the plan pending and does not resume cancellation or rewrite metadata", async () => {
  const calls = [];
  const stripe = stripeClient(calls, async (id, params, callNumber) => {
    if (callNumber === 1) return { id, ...params, pending_update: { expires_at: 1_800_000_000 } };
    throw new Error("finalization must not run while payment is pending");
  });
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  const result = await gateway.changeSubscriptionPlan({
    subscriptionId: "sub_1",
    priceId: "price_business123",
    plan: "business",
    upgrade: true,
  });
  assert.equal(result.applied, false);
  assert.equal(result.pending, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.proration_behavior, "always_invoice");
  assert.equal(calls[0].params.payment_behavior, "pending_if_incomplete");
});

test("downgrade creates ordinary prorations without forcing an immediate refund", async () => {
  const calls = [];
  const gateway = createStripeSubscriptionGateway(stripeClient(calls), "whsec_test");
  const result = await gateway.changeSubscriptionPlan({
    subscriptionId: "sub_1",
    priceId: "price_dev123",
    plan: "developer",
    upgrade: false,
  });
  assert.equal(result.applied, true);
  assert.deepEqual(calls[0], {
    id: "sub_1",
    params: {
      items: [{ id: "si_1", price: "price_dev123", quantity: 1 }],
      proration_behavior: "create_prorations",
    },
  });
  assert.equal("payment_behavior" in calls[0].params, false);
  assert.deepEqual(calls[1], {
    id: "sub_1",
    params: {
      metadata: { accountId: "acct_1", email: "dev@example.com", plan: "developer" },
      cancel_at_period_end: false,
    },
  });
});

test("plan change fails closed when Stripe subscription shape is not a single managed item", async () => {
  const stripe = stripeClient([]);
  stripe.subscriptions.retrieve = async () => ({ id: "sub_1", items: { data: [] } });
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  await assert.rejects(
    () => gateway.changeSubscriptionPlan({ subscriptionId: "sub_1", priceId: "price_pro123", plan: "pro", upgrade: true }),
    /exactly one managed plan item/,
  );
});
