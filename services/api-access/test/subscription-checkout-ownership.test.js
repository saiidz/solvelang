import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";

const ADMIN_SECRET = "a".repeat(48);

function checkoutFixture(account) {
  const checkoutCalls = [];
  const service = {
    async getSubscriptionAccount(accountId) {
      assert.equal(accountId, "acct_session");
      return account;
    },
  };
  const customerAuth = {
    async authenticate() {
      return {
        accountId: "acct_session",
        email: "owner@example.com",
        csrfToken: "csrf_session",
      };
    },
    assertCsrf(session, presented) {
      assert.equal(session.accountId, "acct_session");
      assert.equal(presented, "csrf_session");
    },
  };
  const subscriptionCheckout = {
    async createCheckout(input) {
      checkoutCalls.push(input);
      return { sessionId: "cs_test_ownership", clientSecret: "cs_test_ownership_secret" };
    },
  };
  const handler = createApiAccessHandler({
    service,
    enabled: true,
    adminSecret: ADMIN_SECRET,
    siteOrigin: "https://www.solve-lang.com",
    customerAccountsEnabled: true,
    customerAuth,
    customerAccount: {},
    subscriptionBillingEnabled: true,
    subscriptionCheckout,
    subscriptionLifecycle: { processEvent: async () => ({ handled: true, duplicate: false }) },
    stripeGateway: { constructWebhookEvent: () => ({}) },
    logger: { error() {} },
  });
  return { handler, checkoutCalls };
}

function customerCheckoutEvent(body) {
  return {
    requestContext: { http: { method: "POST", sourceIp: "127.0.0.1" } },
    rawPath: "/customer/subscriptions/checkout",
    headers: {
      cookie: "solvelang_session=fixture",
      "x-solvelang-csrf": "csrf_session",
    },
    body: JSON.stringify(body),
  };
}

test("customer checkout ignores caller-supplied account, email, and Stripe customer identity", async () => {
  const { handler, checkoutCalls } = checkoutFixture({
    accountId: "acct_session",
    email: "owner@example.com",
    stripeCustomerId: "cus_server_owned",
  });

  const response = await handler(customerCheckoutEvent({
    accountId: "acct_attacker",
    email: "attacker@example.com",
    customerId: "cus_attacker",
    plan: "pro",
    requestId: "checkout_owner_1",
  }));

  assert.equal(response.statusCode, 201);
  assert.deepEqual(JSON.parse(response.body), {
    sessionId: "cs_test_ownership",
    clientSecret: "cs_test_ownership_secret",
  });
  assert.deepEqual(checkoutCalls, [{
    accountId: "acct_session",
    email: "owner@example.com",
    plan: "pro",
    requestId: "checkout_owner_1",
    customerId: "cus_server_owned",
  }]);
});

test("customer checkout cannot inject a Stripe customer when the account has none", async () => {
  const { handler, checkoutCalls } = checkoutFixture({
    accountId: "acct_session",
    email: "owner@example.com",
  });

  const response = await handler(customerCheckoutEvent({
    customerId: "cus_attacker",
    plan: "developer",
    requestId: "checkout_owner_2",
  }));

  assert.equal(response.statusCode, 201);
  assert.deepEqual(checkoutCalls, [{
    accountId: "acct_session",
    email: "owner@example.com",
    plan: "developer",
    requestId: "checkout_owner_2",
    customerId: undefined,
  }]);
});
