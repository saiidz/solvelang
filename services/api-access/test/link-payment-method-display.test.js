import assert from "node:assert/strict";
import test from "node:test";
import { createStripeSubscriptionGateway } from "../src/stripe-subscriptions.js";
import { createSubscriptionManagementService } from "../src/subscription-management.js";

const account = {
  accountId: "acct_0123456789abcdef0123456789abcdef",
  plan: "business",
  subscriptionStatus: "active",
  currentPeriodEnd: 1_788_000_000_000,
  stripeCustomerId: "cus_123",
  stripeSubscriptionId: "sub_123",
};

function serviceGateway(paymentMethod) {
  return {
    retrieveSubscriptionManagement: async () => ({
      subscription: { status: "active", cancel_at_period_end: false },
      paymentMethod,
      defaultPaymentMethodId: paymentMethod?.id ?? null,
      attachedPaymentMethods: [],
      invoices: { data: [] },
    }),
    createPaymentMethodSetup: async () => ({}),
    retrievePaymentMethodSetup: async () => ({}),
    setDefaultPaymentMethod: async () => ({ applied: true }),
    detachPaymentMethod: async () => ({ detached: true }),
    setCancelAtPeriodEnd: async () => ({}),
    changeSubscriptionPlan: async () => ({ applied: true }),
  };
}

function apiService() {
  return { getSubscriptionAccount: async () => account };
}

function stripeClient({ paymentIntentCustomer = "cus_1" } = {}) {
  return {
    checkout: { sessions: { create: async () => ({}) } },
    subscriptions: {
      retrieve: async () => ({ id: "sub_1", customer: "cus_1", default_payment_method: "pm_link" }),
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
      list: async () => ({ data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_paid" } }] }),
    },
    paymentIntents: {
      retrieve: async () => ({ id: "pi_paid", customer: paymentIntentCustomer, payment_method: "pm_link" }),
    },
    paymentMethods: {
      retrieve: async () => ({ id: "pm_link", customer: null, type: "link", link: { email: "buyer@example.com" } }),
      list: async () => ({ data: [] }),
      detach: async () => ({}),
    },
    setupIntents: { create: async () => ({}), retrieve: async () => ({}) },
    webhooks: { constructEvent: () => ({}) },
  };
}

test("paid customer-owned Stripe Link payment is resolved for subscription management", async () => {
  const gateway = createStripeSubscriptionGateway(stripeClient(), "whsec_test");
  const state = await gateway.retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(state.paymentMethodSource, "paid_invoice");
  assert.equal(state.paymentMethod.type, "link");
  assert.equal(state.paymentMethod.id, "pm_link");
});

test("Stripe Link payment is ignored when its successful PaymentIntent belongs to another customer", async () => {
  const gateway = createStripeSubscriptionGateway(stripeClient({ paymentIntentCustomer: "cus_attacker" }), "whsec_test");
  const state = await gateway.retrieveSubscriptionManagement({ customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(state.paymentMethod, null);
});

test("management API returns a safe Link summary without exposing Link account details", async () => {
  const service = createSubscriptionManagementService({
    gateway: serviceGateway({ id: "pm_link", type: "link", link: { email: "buyer@example.com" } }),
    apiAccessService: apiService(),
    priceIds: {},
    enabled: true,
  });
  const state = await service.getManagement({ accountId: account.accountId });
  assert.deepEqual(state.paymentMethod, {
    id: "pm_link",
    type: "link",
    label: "Link",
    brand: null,
    last4: null,
    expMonth: null,
    expYear: null,
    isDefault: true,
  });
  assert.equal(JSON.stringify(state).includes("buyer@example.com"), false);
});

test("management API keeps masked card summaries", async () => {
  const service = createSubscriptionManagementService({
    gateway: serviceGateway({ id: "pm_card", type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2034 } }),
    apiAccessService: apiService(),
    priceIds: {},
    enabled: true,
  });
  const state = await service.getManagement({ accountId: account.accountId });
  assert.deepEqual(state.paymentMethod, {
    id: "pm_card",
    type: "card",
    label: "Visa •••• 4242",
    brand: "visa",
    last4: "4242",
    expMonth: 12,
    expYear: 2034,
    isDefault: true,
  });
});
