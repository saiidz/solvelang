import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";

const adminSecret = "a".repeat(64);

function event(rawPath, body = {}) {
  return {
    rawPath,
    headers: { "x-solvelang-admin-secret": adminSecret },
    body: JSON.stringify(body),
    requestContext: { http: { method: "POST", sourceIp: "203.0.113.8" } },
  };
}

test("billing kill switch blocks internal checkout and provisioning before side effects", async () => {
  let checkoutCalls = 0;
  let provisionCalls = 0;

  const handler = createApiAccessHandler({
    service: {
      async provisionSubscription() {
        provisionCalls += 1;
        return { id: "must-not-be-created" };
      },
    },
    enabled: true,
    adminSecret,
    siteOrigin: "https://www.solve-lang.com",
    subscriptionBillingEnabled: false,
    subscriptionCheckout: {
      async createCheckout() {
        checkoutCalls += 1;
        return { sessionId: "must-not-be-created" };
      },
    },
    logger: { error() {} },
  });

  const checkout = await handler(event("/internal/subscriptions/checkout", { plan: "pro" }));
  assert.equal(checkout.statusCode, 503);
  assert.equal(JSON.parse(checkout.body).code, "subscription_billing_disabled");

  const provision = await handler(event("/internal/subscriptions/provision", {
    accountId: "acct_test",
    plan: "pro",
  }));
  assert.equal(provision.statusCode, 503);
  assert.equal(JSON.parse(provision.body).code, "subscription_billing_disabled");

  assert.equal(checkoutCalls, 0);
  assert.equal(provisionCalls, 0);
});
