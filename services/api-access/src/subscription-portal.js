import { ApiAccessError } from "./service.js";

function cleanId(value, label) {
  if (typeof value !== "string") throw new ApiAccessError(400, "invalid_subscription_portal", `${label} is invalid.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 200 || !/^[A-Za-z0-9_.:-]+$/.test(cleaned)) {
    throw new ApiAccessError(400, "invalid_subscription_portal", `${label} is invalid.`);
  }
  return cleaned;
}

export function createSubscriptionPortalService({ gateway, apiAccessService, siteOrigin, enabled = false }) {
  if (!gateway || typeof gateway.createPortalSession !== "function") throw new Error("Stripe subscription gateway is required.");
  if (!apiAccessService || typeof apiAccessService.getSubscriptionAccount !== "function") {
    throw new Error("API access service is required.");
  }
  if (typeof siteOrigin !== "string" || !/^https:\/\//.test(siteOrigin)) throw new Error("HTTPS site origin is required.");

  return {
    async createPortal(input) {
      if (!enabled) throw new ApiAccessError(503, "subscription_portal_disabled", "API subscription management is not enabled.");
      const accountId = cleanId(input?.accountId, "Account ID");
      const account = await apiAccessService.getSubscriptionAccount(accountId);
      if (!account?.stripeCustomerId) {
        throw new ApiAccessError(409, "subscription_customer_missing", "No managed subscription is available for this account.");
      }

      const session = await gateway.createPortalSession({
        customerId: cleanId(account.stripeCustomerId, "Stripe customer ID"),
        returnUrl: `${siteOrigin}/account/api-keys/?portal=return`,
      });
      if (!session?.id || typeof session.url !== "string" || !/^https:\/\/billing\.stripe\.com\//.test(session.url)) {
        throw new ApiAccessError(502, "stripe_portal_unavailable", "Subscription management is temporarily unavailable.");
      }
      return { url: session.url };
    },
  };
}
