import assert from "node:assert/strict";
import test from "node:test";
import { ApiAccessError } from "../src/service.js";
import { createSubscriptionPortalService } from "../src/subscription-portal.js";

function apiService(account) {
  return { getSubscriptionAccount: async () => account };
}

test("routes subscribed customers to the internal SolveLang management page", async () => {
  const portal = createSubscriptionPortalService({
    apiAccessService: apiService({ stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" }),
    siteOrigin: "https://www.solve-lang.com",
    enabled: true,
  });

  assert.deepEqual(await portal.createPortal({ accountId: "acct_1", customerId: "cus_attacker" }), {
    url: "https://www.solve-lang.com/account/api-subscription/",
  });
});

test("fails closed when management is disabled or no managed subscription exists", async () => {
  const disabled = createSubscriptionPortalService({
    apiAccessService: apiService({ stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" }),
    siteOrigin: "https://www.solve-lang.com",
    enabled: false,
  });
  await assert.rejects(
    () => disabled.createPortal({ accountId: "acct_1" }),
    (error) => error instanceof ApiAccessError && error.code === "subscription_portal_disabled",
  );

  const missing = createSubscriptionPortalService({
    apiAccessService: apiService(undefined),
    siteOrigin: "https://www.solve-lang.com",
    enabled: true,
  });
  await assert.rejects(
    () => missing.createPortal({ accountId: "acct_1" }),
    (error) => error instanceof ApiAccessError && error.code === "subscription_customer_missing",
  );
});
