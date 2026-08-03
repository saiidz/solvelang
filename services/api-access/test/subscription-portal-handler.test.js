import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { ApiAccessError } from "../src/service.js";

const adminSecret = "a".repeat(64);

function event(headers = {}) {
  return {
    rawPath: "/customer/subscriptions/portal",
    headers,
    body: JSON.stringify({ accountId: "acct_attacker", customerId: "cus_attacker" }),
    cookies: ["sl_api_session=sess_test"],
    requestContext: { http: { method: "POST" } },
  };
}

test("portal creation requires CSRF and derives account ownership from the session", async () => {
  const seen = [];
  const session = { accountId: "acct_session", email: "dev@example.com", csrfToken: "csrf_ok" };
  const customerAuth = {
    authenticate: async (cookie) => {
      seen.push(["cookie", cookie]);
      return session;
    },
    assertCsrf: (_session, presented) => {
      if (presented !== session.csrfToken) throw new ApiAccessError(403, "invalid_csrf", "The request could not be verified.");
    },
  };
  const handler = createApiAccessHandler({
    service: { getSubscriptionAccount: async () => ({ stripeCustomerId: "cus_server" }) },
    enabled: true,
    adminSecret,
    siteOrigin: "https://www.solve-lang.com",
    customerAccountsEnabled: true,
    customerAuth,
    customerAccount: {},
    subscriptionBillingEnabled: true,
    subscriptionCheckout: { createCheckout: async () => ({}) },
    subscriptionPortal: {
      createPortal: async (input) => {
        seen.push(["portal", input]);
        return { url: "https://billing.stripe.com/p/session/test" };
      },
    },
    subscriptionLifecycle: { processEvent: async () => ({ handled: true, duplicate: false }) },
    stripeGateway: { constructWebhookEvent() {} },
    logger: { error() {} },
  });

  const denied = await handler(event());
  assert.equal(denied.statusCode, 403);
  assert.equal(JSON.parse(denied.body).code, "invalid_csrf");

  const accepted = await handler(event({ "x-solvelang-csrf": "csrf_ok" }));
  assert.equal(accepted.statusCode, 201);
  assert.deepEqual(JSON.parse(accepted.body), { url: "https://billing.stripe.com/p/session/test" });
  assert.deepEqual(seen.find((entry) => entry[0] === "portal"), ["portal", { accountId: "acct_session" }]);
  assert.deepEqual(seen.find((entry) => entry[0] === "cookie"), ["cookie", "sl_api_session=sess_test"]);
});
