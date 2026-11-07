import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { createSubscriptionLifecycleService } from "../src/subscriptions.js";
import { ApiAccessError } from "../src/service.js";

const ADMIN_SECRET = "a".repeat(64);
const CUSTOMER_PATH = "/customer/subscriptions/merge-governance/elements-checkout";
const INTERNAL_PATH = "/internal/subscriptions/merge-governance/elements-checkout";

// Mirrors the real gate in customer-auth.js: authenticate() throws
// 401 invalid_session when the sl_api_session cookie is missing, invalid,
// or expired, and assertCsrf throws 403 invalid_csrf when the presented
// token does not match the session token.
function gateFixture({ authenticated = true } = {}) {
  const checkoutCalls = [];
  const customerAuth = {
    async authenticate() {
      if (!authenticated) throw new ApiAccessError(401, "invalid_session", "Sign in again to continue.");
      return { accountId: "acct_session", email: "owner@example.com", csrfToken: "csrf_session" };
    },
    assertCsrf(session, presented) {
      if (presented !== session.csrfToken) throw new ApiAccessError(403, "invalid_csrf", "The request could not be verified.");
    },
  };
  const handler = createApiAccessHandler({
    service: {
      async getSubscriptionAccount(accountId) {
        assert.equal(accountId, "acct_session");
        return { stripeCustomerId: "cus_from_account" };
      },
    },
    enabled: true,
    adminSecret: ADMIN_SECRET,
    siteOrigin: "https://www.solve-lang.com",
    customerAccountsEnabled: true,
    customerAuth,
    customerAccount: {},
    subscriptionBillingEnabled: true,
    subscriptionCheckout: { createCheckout: async () => ({}) },
    subscriptionLifecycle: { processEvent: async () => ({ handled: true, duplicate: false }) },
    stripeGateway: { constructWebhookEvent: () => ({}) },
    mergeGovernanceCheckout: {
      async createMergeGovernanceCheckout(input) {
        checkoutCalls.push(input);
        return {
          subscriptionId: "sub_mgov",
          customerId: input.customerId ?? "cus_new",
          paymentRequired: true,
          clientSecret: "pi_mgov_secret",
        };
      },
    },
    logger: { error() {} },
  });
  return { handler, checkoutCalls };
}

function customerEvent(body, { csrf = "csrf_session" } = {}) {
  return {
    requestContext: { http: { method: "POST", sourceIp: "127.0.0.1" } },
    rawPath: CUSTOMER_PATH,
    headers: {
      cookie: "sl_api_session=sess_test",
      ...(csrf === null ? {} : { "x-solvelang-csrf": csrf }),
    },
    body: JSON.stringify(body),
  };
}

test("unauthenticated checkout request is rejected by the session gate (401 invalid_session)", async () => {
  const { handler, checkoutCalls } = gateFixture({ authenticated: false });
  const response = await handler(customerEvent({ plan: "mgov-regular-monthly", quantity: 2, requestId: "checkout_1" }));
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).code, "invalid_session");
  assert.equal(checkoutCalls.length, 0);
});

test("checkout mutation without the session CSRF token is rejected (403 invalid_csrf)", async () => {
  const { handler, checkoutCalls } = gateFixture();
  const response = await handler(customerEvent({ plan: "mgov-regular-monthly", requestId: "checkout_1" }, { csrf: null }));
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).code, "invalid_csrf");
  assert.equal(checkoutCalls.length, 0);
});

test("authenticated checkout is created from the session identity, never caller-supplied identity", async () => {
  const { handler, checkoutCalls } = gateFixture();
  const response = await handler(customerEvent({
    plan: "mgov-plus-monthly",
    quantity: 3,
    requestId: "checkout_1",
    promotionCode: "WELCOME",
    accountId: "acct_attacker",
    email: "attacker@example.com",
    customerId: "cus_attacker",
  }));
  assert.equal(response.statusCode, 201);
  assert.deepEqual(JSON.parse(response.body), {
    subscriptionId: "sub_mgov",
    customerId: "cus_from_account",
    paymentRequired: true,
    clientSecret: "pi_mgov_secret",
  });
  assert.deepEqual(checkoutCalls, [{
    accountId: "acct_session",
    email: "owner@example.com",
    plan: "mgov-plus-monthly",
    quantity: 3,
    requestId: "checkout_1",
    customerId: "cus_from_account",
    promotionCode: "WELCOME",
  }]);
});

test("the internal checkout route stays behind the admin secret", async () => {
  const { handler, checkoutCalls } = gateFixture();
  const denied = await handler({
    requestContext: { http: { method: "POST", sourceIp: "127.0.0.1" } },
    rawPath: INTERNAL_PATH,
    headers: {},
    body: JSON.stringify({ accountId: "acct_internal", email: "ops@example.com", plan: "mgov-regular-annual", requestId: "checkout_2" }),
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(JSON.parse(denied.body).code, "admin_denied");
  assert.equal(checkoutCalls.length, 0);

  const allowed = await handler({
    requestContext: { http: { method: "POST", sourceIp: "127.0.0.1" } },
    rawPath: INTERNAL_PATH,
    headers: { "x-solvelang-admin-secret": ADMIN_SECRET },
    body: JSON.stringify({ accountId: "acct_internal", email: "ops@example.com", plan: "mgov-regular-annual", requestId: "checkout_2" }),
  });
  assert.equal(allowed.statusCode, 201);
  assert.equal(checkoutCalls.length, 1);
  assert.equal(checkoutCalls[0].accountId, "acct_internal");
});

function lifecycleFixture() {
  return createSubscriptionLifecycleService({
    apiAccessService: {
      provisionSubscription: async () => { throw new Error("must not provision"); },
      getSubscriptionAccount: async () => { throw new Error("must not read the account"); },
    },
    eventStore: {
      claimEvent: async () => { throw new Error("must not claim"); },
      completeEvent: async () => "completed",
      releaseEvent: async () => {},
    },
    priceIds: { developer: "price_dev123", pro: "price_pro123", business: "price_business123" },
  });
}

function subscriptionEvent(metadata, priceId) {
  return {
    id: "evt_mgov_1",
    type: "customer.subscription.created",
    created: 1_794_000_000,
    data: {
      object: {
        id: "sub_mgov",
        customer: "cus_1",
        status: "incomplete",
        metadata,
        items: { data: [{ price: { id: priceId }, current_period_end: 1_800_000_000 }] },
      },
    },
  };
}

test("the API lifecycle acknowledges and skips Merge Governance subscription events", async () => {
  const lifecycle = lifecycleFixture();
  const result = await lifecycle.processEvent(subscriptionEvent(
    { accountId: "acct_1", email: "dev@example.com", plan: "mgov-regular-monthly", product: "merge-governance" },
    "price_1UZGDH4HWc7PvaDYJ1W9Rlxh",
  ));
  assert.deepEqual(result, { handled: false, duplicate: false, ignored: "merge-governance" });
});

test("the lifecycle skip is marker-specific: unmarked unknown prices still fail closed", async () => {
  const lifecycle = lifecycleFixture();
  await assert.rejects(
    lifecycle.processEvent(subscriptionEvent(
      { accountId: "acct_1", email: "dev@example.com", plan: "mgov-regular-monthly" },
      "price_1UZGDH4HWc7PvaDYJ1W9Rlxh",
    )),
    (error) => error instanceof ApiAccessError && error.code === "unknown_subscription_price",
  );
});
