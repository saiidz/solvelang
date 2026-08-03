import assert from "node:assert/strict";
import test from "node:test";
import { ApiAccessError } from "../src/service.js";
import { createSubscriptionManagementHandler } from "../src/subscription-management-handler.js";

function event(body, headers = {}) {
  return {
    rawPath: "/customer/subscriptions/portal",
    headers,
    cookies: ["sl_api_session=sess_test"],
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method: "POST" } },
  };
}

test("requires the authenticated session and CSRF token and never accepts browser ownership IDs", async () => {
  const seen = [];
  const customerAuth = {
    authenticate: async (cookie) => {
      seen.push(["cookie", cookie]);
      return { accountId: "acct_0123456789abcdef0123456789abcdef", csrfToken: "csrf_ok" };
    },
    assertCsrf: (_session, presented) => {
      if (presented !== "csrf_ok") throw new ApiAccessError(403, "invalid_csrf", "The request could not be verified.");
    },
  };
  const management = {
    getManagement: async (input) => {
      seen.push(["get", input]);
      return { subscription: { plan: "developer" }, paymentMethod: null, invoices: [] };
    },
    createPaymentSetup: async (input) => { seen.push(["setup", input]); return { clientSecret: "secret" }; },
    completePaymentSetup: async (input) => { seen.push(["complete", input]); return { ok: true }; },
    setCancellation: async (input) => { seen.push(["cancel", input]); return { ok: true }; },
  };
  const handler = createSubscriptionManagementHandler({
    customerAuth,
    management,
    siteOrigin: "https://www.solve-lang.com",
    enabled: true,
    logger: { error() {} },
  });

  const denied = await handler(event({ action: "get_management" }));
  assert.equal(denied.statusCode, 403);

  const state = await handler(event(
    { action: "get_management", accountId: "acct_attacker" },
    { "x-solvelang-csrf": "csrf_ok" },
  ));
  assert.equal(state.statusCode, 200);
  assert.equal(JSON.parse(state.body).csrfToken, "csrf_ok");

  await handler(event(
    { action: "complete_payment_setup", setupIntentId: "seti_123", customerId: "cus_attacker" },
    { "x-solvelang-csrf": "csrf_ok" },
  ));
  await handler(event(
    { action: "cancel_at_period_end", subscriptionId: "sub_attacker" },
    { "x-solvelang-csrf": "csrf_ok" },
  ));

  const accountId = "acct_0123456789abcdef0123456789abcdef";
  assert.deepEqual(seen.find((entry) => entry[0] === "get"), ["get", { accountId }]);
  assert.deepEqual(seen.find((entry) => entry[0] === "complete"), ["complete", { accountId, setupIntentId: "seti_123" }]);
  assert.deepEqual(seen.find((entry) => entry[0] === "cancel"), ["cancel", { accountId, cancelAtPeriodEnd: true }]);
});

test("rejects unknown actions and disabled management with sanitized errors", async () => {
  const customerAuth = {
    authenticate: async () => ({ accountId: "acct_0123456789abcdef0123456789abcdef", csrfToken: "csrf_ok" }),
    assertCsrf() {},
  };
  const management = {
    getManagement: async () => ({}),
    createPaymentSetup: async () => ({}),
    completePaymentSetup: async () => ({}),
    setCancellation: async () => ({}),
  };
  const handler = createSubscriptionManagementHandler({
    customerAuth,
    management,
    siteOrigin: "https://www.solve-lang.com",
    enabled: true,
    logger: { error() {} },
  });
  const unknown = await handler(event({ action: "delete_everything" }, { "x-solvelang-csrf": "csrf_ok" }));
  assert.equal(unknown.statusCode, 400);
  assert.equal(JSON.parse(unknown.body).code, "invalid_subscription_management");

  const disabled = createSubscriptionManagementHandler({
    customerAuth,
    management,
    siteOrigin: "https://www.solve-lang.com",
    enabled: false,
    logger: { error() {} },
  });
  const unavailable = await disabled(event({ action: "get_management" }, { "x-solvelang-csrf": "csrf_ok" }));
  assert.equal(unavailable.statusCode, 503);
});
