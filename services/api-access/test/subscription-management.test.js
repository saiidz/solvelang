import assert from "node:assert/strict";
import test from "node:test";
import { ApiAccessError } from "../src/service.js";
import { createSubscriptionManagementService } from "../src/subscription-management.js";

const account = {
  accountId: "acct_0123456789abcdef0123456789abcdef",
  plan: "developer",
  subscriptionStatus: "active",
  currentPeriodEnd: 1_788_000_000_000,
  stripeCustomerId: "cus_123",
  stripeSubscriptionId: "sub_123",
};

const priceIds = {
  developer: "price_dev123",
  pro: "price_pro123",
  business: "price_business123",
};

function apiService(value = account) {
  return { getSubscriptionAccount: async () => value };
}

function gateway(overrides = {}) {
  return {
    retrieveSubscriptionManagement: async () => ({
      subscription: { status: "active", cancel_at_period_end: false },
      paymentMethod: { id: "pm_123", type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2034 } },
      defaultPaymentMethodId: "pm_123",
      attachedPaymentMethods: [],
      invoices: {
        data: [{
          id: "in_1",
          number: "INV-1",
          status: "paid",
          amount_paid: 4900,
          amount_due: 4900,
          currency: "usd",
          created: 1_785_000_000,
        }],
      },
    }),
    createPaymentMethodSetup: async () => ({ id: "seti_123", client_secret: "seti_123_secret_test" }),
    retrievePaymentMethodSetup: async () => ({
      id: "seti_123",
      status: "succeeded",
      customer: "cus_123",
      payment_method: "pm_123",
    }),
    setDefaultPaymentMethod: async () => ({ applied: true }),
    detachPaymentMethod: async () => ({ detached: true }),
    setCancelAtPeriodEnd: async () => ({}),
    changeSubscriptionPlan: async () => ({ applied: true, pending: false }),
    ...overrides,
  };
}

test("returns only sanitized subscription, card, and invoice fields", async () => {
  const service = createSubscriptionManagementService({ gateway: gateway(), apiAccessService: apiService(), priceIds, enabled: true });
  assert.deepEqual(await service.getManagement({ accountId: account.accountId }), {
    subscription: {
      plan: "developer",
      status: "active",
      currentPeriodEnd: account.currentPeriodEnd,
      cancelAtPeriodEnd: false,
    },
    paymentMethod: {
      id: "pm_123",
      type: "card",
      label: "Visa •••• 4242",
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2034,
      isDefault: true,
    },
    attachedPaymentMethods: [],
    invoices: [{
      id: "in_1",
      number: "INV-1",
      status: "paid",
      amountPaid: 4900,
      amountDue: 4900,
      currency: "USD",
      createdAt: 1_785_000_000_000,
    }],
  });
});

test("returns masked saved cards with Stripe references and never leaks fingerprints", async () => {
  const service = createSubscriptionManagementService({
    gateway: gateway({
      retrieveSubscriptionManagement: async () => ({
        subscription: { status: "active" },
        paymentMethod: null,
        defaultPaymentMethodId: "pm_secret_2",
        attachedPaymentMethods: [
          { id: "pm_secret_1", customer: "cus_123", type: "card", card: { brand: "visa", last4: "1111", exp_month: 1, exp_year: 2035, fingerprint: "secret" } },
          { id: "pm_secret_2", customer: "cus_123", type: "card", card: { brand: "mastercard", last4: "2222", exp_month: 2, exp_year: 2036 } },
        ],
        invoices: { data: [] },
      }),
    }),
    apiAccessService: apiService(),
    priceIds,
    enabled: true,
  });
  const state = await service.getManagement({ accountId: account.accountId });
  assert.equal(state.paymentMethod, null);
  assert.deepEqual(state.attachedPaymentMethods, [
    { id: "pm_secret_1", type: "card", label: "Visa •••• 1111", brand: "visa", last4: "1111", expMonth: 1, expYear: 2035, isDefault: false },
    { id: "pm_secret_2", type: "card", label: "Mastercard •••• 2222", brand: "mastercard", last4: "2222", expMonth: 2, expYear: 2036, isDefault: true },
  ]);
  assert.equal(JSON.stringify(state).includes("fingerprint"), false);
});

test("creates a card SetupIntent and applies it only after customer ownership and success checks", async () => {
  const calls = [];
  const service = createSubscriptionManagementService({
    gateway: gateway({
      createPaymentMethodSetup: async (input) => { calls.push(["create", input]); return { id: "seti_123", client_secret: "seti_123_secret_test" }; },
      setDefaultPaymentMethod: async (input) => { calls.push(["default", input]); return { applied: true }; },
    }),
    apiAccessService: apiService(),
    priceIds,
    enabled: true,
  });
  assert.deepEqual(await service.createPaymentSetup({ accountId: account.accountId }), {
    setupIntentId: "seti_123",
    clientSecret: "seti_123_secret_test",
  });
  await service.completePaymentSetup({ accountId: account.accountId, setupIntentId: "seti_123" });
  assert.deepEqual(calls, [
    ["create", { accountId: account.accountId, customerId: "cus_123" }],
    ["default", { customerId: "cus_123", subscriptionId: "sub_123", paymentMethodId: "pm_123" }],
  ]);
});

test("rejects a SetupIntent owned by another Stripe customer", async () => {
  const service = createSubscriptionManagementService({
    gateway: gateway({
      retrievePaymentMethodSetup: async () => ({
        id: "seti_123",
        status: "succeeded",
        customer: "cus_attacker",
        payment_method: "pm_123",
      }),
      setDefaultPaymentMethod: async () => { throw new Error("should not run"); },
    }),
    apiAccessService: apiService(),
    priceIds,
    enabled: true,
  });
  await assert.rejects(
    () => service.completePaymentSetup({ accountId: account.accountId, setupIntentId: "seti_123" }),
    (error) => error instanceof ApiAccessError && error.code === "payment_setup_incomplete",
  );
});

test("sets an existing saved card as default using only server-owned customer and subscription IDs", async () => {
  const calls = [];
  const service = createSubscriptionManagementService({
    gateway: gateway({
      setDefaultPaymentMethod: async (input) => { calls.push(input); return { applied: true }; },
    }),
    apiAccessService: apiService(),
    priceIds,
    enabled: true,
  });
  await service.setPaymentMethodDefault({ accountId: account.accountId, paymentMethodId: "pm_saved123" });
  assert.deepEqual(calls, [{ customerId: "cus_123", subscriptionId: "sub_123", paymentMethodId: "pm_saved123" }]);
});

test("removes a non-default saved card but refuses to remove the billing default", async () => {
  const calls = [];
  const service = createSubscriptionManagementService({
    gateway: gateway({
      detachPaymentMethod: async (input) => {
        calls.push(input);
        return input.paymentMethodId === "pm_default123"
          ? { detached: false, reason: "default" }
          : { detached: true };
      },
    }),
    apiAccessService: apiService(),
    priceIds,
    enabled: true,
  });
  await service.removePaymentMethod({ accountId: account.accountId, paymentMethodId: "pm_old123" });
  await assert.rejects(
    () => service.removePaymentMethod({ accountId: account.accountId, paymentMethodId: "pm_default123" }),
    (error) => error instanceof ApiAccessError && error.code === "payment_method_is_default",
  );
  assert.deepEqual(calls, [
    { customerId: "cus_123", subscriptionId: "sub_123", paymentMethodId: "pm_old123" },
    { customerId: "cus_123", subscriptionId: "sub_123", paymentMethodId: "pm_default123" },
  ]);
});

test("schedules and reverses cancellation only from the server-owned subscription", async () => {
  const calls = [];
  const service = createSubscriptionManagementService({
    gateway: gateway({ setCancelAtPeriodEnd: async (input) => { calls.push(input); } }),
    apiAccessService: apiService(),
    priceIds,
    enabled: true,
  });
  await service.setCancellation({ accountId: account.accountId, cancelAtPeriodEnd: true });
  await service.setCancellation({ accountId: account.accountId, cancelAtPeriodEnd: false });
  assert.deepEqual(calls, [
    { subscriptionId: "sub_123", cancelAtPeriodEnd: true },
    { subscriptionId: "sub_123", cancelAtPeriodEnd: false },
  ]);
});

test("marks a higher-tier plan change as an upgrade and only exposes it after Stripe applies it", async () => {
  const calls = [];
  const service = createSubscriptionManagementService({
    gateway: gateway({
      changeSubscriptionPlan: async (input) => { calls.push(input); return { applied: true, pending: false }; },
      retrieveSubscriptionManagement: async () => ({
        subscription: { status: "active", cancel_at_period_end: false },
        paymentMethod: null,
        attachedPaymentMethods: [],
        invoices: { data: [] },
      }),
    }),
    apiAccessService: apiService(),
    priceIds,
    enabled: true,
  });
  const state = await service.changePlan({ accountId: account.accountId, plan: "pro" });
  assert.deepEqual(calls, [{ subscriptionId: "sub_123", priceId: "price_pro123", plan: "pro", upgrade: true }]);
  assert.equal(state.subscription.plan, "pro");
  assert.equal(state.subscription.cancelAtPeriodEnd, false);
});

test("failed or action-required upgrade payment preserves the current entitlement", async () => {
  const service = createSubscriptionManagementService({
    gateway: gateway({ changeSubscriptionPlan: async () => ({ applied: false, pending: true }) }),
    apiAccessService: apiService(),
    priceIds,
    enabled: true,
  });
  await assert.rejects(
    () => service.changePlan({ accountId: account.accountId, plan: "business" }),
    (error) => error instanceof ApiAccessError
      && error.statusCode === 402
      && error.code === "subscription_upgrade_payment_required",
  );
});

test("marks a lower-tier plan change as a downgrade", async () => {
  const calls = [];
  const businessAccount = { ...account, plan: "business" };
  const service = createSubscriptionManagementService({
    gateway: gateway({ changeSubscriptionPlan: async (input) => { calls.push(input); return { applied: true, pending: false }; } }),
    apiAccessService: apiService(businessAccount),
    priceIds,
    enabled: true,
  });
  await service.changePlan({ accountId: account.accountId, plan: "developer" });
  assert.deepEqual(calls, [{ subscriptionId: "sub_123", priceId: "price_dev123", plan: "developer", upgrade: false }]);
});

test("rejects unknown or unchanged subscription plans before Stripe is called", async () => {
  let called = false;
  const service = createSubscriptionManagementService({
    gateway: gateway({ changeSubscriptionPlan: async () => { called = true; return { applied: true }; } }),
    apiAccessService: apiService(),
    priceIds,
    enabled: true,
  });
  await assert.rejects(
    () => service.changePlan({ accountId: account.accountId, plan: "enterprise" }),
    (error) => error instanceof ApiAccessError && error.code === "invalid_subscription_plan",
  );
  await assert.rejects(
    () => service.changePlan({ accountId: account.accountId, plan: "developer" }),
    (error) => error instanceof ApiAccessError && error.code === "subscription_plan_unchanged",
  );
  assert.equal(called, false);
});

test("fails closed without a managed subscription or when disabled", async () => {
  const disabled = createSubscriptionManagementService({ gateway: gateway(), apiAccessService: apiService(), priceIds, enabled: false });
  await assert.rejects(
    () => disabled.getManagement({ accountId: account.accountId }),
    (error) => error instanceof ApiAccessError && error.code === "subscription_management_disabled",
  );

  const missing = createSubscriptionManagementService({ gateway: gateway(), apiAccessService: apiService(null), priceIds, enabled: true });
  await assert.rejects(
    () => missing.getManagement({ accountId: account.accountId }),
    (error) => error instanceof ApiAccessError && error.code === "subscription_missing",
  );
});
