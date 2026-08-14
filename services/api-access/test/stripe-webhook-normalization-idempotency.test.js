import assert from "node:assert/strict";
import test from "node:test";
import { createStripeSubscriptionGateway } from "../src/stripe-subscriptions.js";

function stripeFixture() {
  let selectedPaymentMethodId = "pm_first";
  const updates = [];
  const stripe = {
    checkout: { sessions: { async create() { return { id: "cs_test", client_secret: "secret" }; } } },
    subscriptions: {
      async retrieve(id) { return { id, customer: "cus_1" }; },
      async update(id, params, options) { updates.push(["subscription", id, params, options]); return { id, ...params }; },
    },
    customers: {
      async retrieve(id) { return { id, invoice_settings: {} }; },
      async update(id, params, options) { updates.push(["customer", id, params, options]); return { id, ...params }; },
    },
    invoices: {
      async list() { return { data: [{ id: "in_paid", status: "paid", amount_paid: 4900, created: 10 }] }; },
    },
    invoicePayments: {
      async list() {
        return { data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_paid" } }] };
      },
    },
    paymentIntents: {
      async retrieve() { return { id: "pi_paid", customer: "cus_1", payment_method: selectedPaymentMethodId }; },
    },
    paymentMethods: {
      async retrieve(id) { return { id, customer: "cus_1", type: "card" }; },
      async list() { return { data: [] }; },
      async detach(id) { return { id, customer: null }; },
    },
    setupIntents: {
      async create() { return { id: "seti_1" }; },
      async retrieve() { return { id: "seti_1" }; },
    },
    webhooks: { constructEvent() {} },
  };
  return {
    stripe,
    updates,
    select(id) { selectedPaymentMethodId = id; },
  };
}

test("webhook normalization idempotency identity includes the selected payment-method target", async () => {
  const fixture = stripeFixture();
  const gateway = createStripeSubscriptionGateway(fixture.stripe, "whsec_test");

  await gateway.normalizeSuccessfulSubscriptionPaymentMethod({
    customerId: "cus_1",
    subscriptionId: "sub_1",
    eventId: "evt_same_event",
  });
  const firstKeys = fixture.updates.map((call) => call[3]?.idempotencyKey);
  assert.equal(firstKeys.length, 2);
  assert.ok(firstKeys.every((key) => /^api-subscription-webhook-[a-f0-9]{64}$/.test(key)));
  assert.notEqual(firstKeys[0], firstKeys[1]);

  fixture.updates.length = 0;
  await gateway.normalizeSuccessfulSubscriptionPaymentMethod({
    customerId: "cus_1",
    subscriptionId: "sub_1",
    eventId: "evt_same_event",
  });
  assert.deepEqual(fixture.updates.map((call) => call[3]?.idempotencyKey), firstKeys);

  fixture.select("pm_second");
  fixture.updates.length = 0;
  await gateway.normalizeSuccessfulSubscriptionPaymentMethod({
    customerId: "cus_1",
    subscriptionId: "sub_1",
    eventId: "evt_same_event",
  });
  const secondKeys = fixture.updates.map((call) => call[3]?.idempotencyKey);
  assert.equal(secondKeys.length, 2);
  assert.notDeepEqual(secondKeys, firstKeys);
  assert.deepEqual(
    fixture.updates.map((call) => call[2]),
    [
      { invoice_settings: { default_payment_method: "pm_second" } },
      { default_payment_method: "pm_second" },
    ],
  );
});
