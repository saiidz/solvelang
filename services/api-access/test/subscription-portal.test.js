import assert from "node:assert/strict";
import test from "node:test";
import { ApiAccessError } from "../src/service.js";
import { createSubscriptionPortalService } from "../src/subscription-portal.js";

function apiService(account) {
  return { getSubscriptionAccount: async () => account };
}

test("creates a Stripe portal session from the server-owned customer ID", async () => {
  const calls = [];
  const portal = createSubscriptionPortalService({
    gateway: {
      createPortalSession: async (input) => {
        calls.push(input);
        return { id: "bps_1", url: "https://billing.stripe.com/p/session/test" };
      },
    },
    apiAccessService: apiService({ stripeCustomerId: "cus_1" }),
    siteOrigin: "https://www.solve-lang.com",
    enabled: true,
  });

  assert.deepEqual(await portal.createPortal({ accountId: "acct_1", customerId: "cus_attacker" }), {
    url: "https://billing.stripe.com/p/session/test",
  });
  assert.deepEqual(calls, [{
    customerId: "cus_1",
    returnUrl: "https://www.solve-lang.com/account/api-keys/?portal=return",
  }]);
});

test("fails closed when management is disabled or no Stripe customer exists", async () => {
  const disabled = createSubscriptionPortalService({
    gateway: { createPortalSession: async () => { throw new Error("should not run"); } },
    apiAccessService: apiService({ stripeCustomerId: "cus_1" }),
    siteOrigin: "https://www.solve-lang.com",
    enabled: false,
  });
  await assert.rejects(
    () => disabled.createPortal({ accountId: "acct_1" }),
    (error) => error instanceof ApiAccessError && error.code === "subscription_portal_disabled",
  );

  const missing = createSubscriptionPortalService({
    gateway: { createPortalSession: async () => { throw new Error("should not run"); } },
    apiAccessService: apiService(undefined),
    siteOrigin: "https://www.solve-lang.com",
    enabled: true,
  });
  await assert.rejects(
    () => missing.createPortal({ accountId: "acct_1" }),
    (error) => error instanceof ApiAccessError && error.code === "subscription_customer_missing",
  );
});

test("rejects malformed Stripe portal responses", async () => {
  const portal = createSubscriptionPortalService({
    gateway: { createPortalSession: async () => ({ id: "bps_1", url: "https://example.com/not-stripe" }) },
    apiAccessService: apiService({ stripeCustomerId: "cus_1" }),
    siteOrigin: "https://www.solve-lang.com",
    enabled: true,
  });
  await assert.rejects(
    () => portal.createPortal({ accountId: "acct_1" }),
    (error) => error instanceof ApiAccessError && error.code === "stripe_portal_unavailable",
  );
});
