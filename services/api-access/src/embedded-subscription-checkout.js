import { ApiAccessError } from "./service.js";
import { getApiPlan } from "./plans.js";

const REPLACEABLE_SUBSCRIPTION_STATUSES = new Set(["canceled", "unpaid"]);

function cleanText(value, label, maximum = 254) {
  if (typeof value !== "string") throw new ApiAccessError(400, "invalid_subscription_checkout", `${label} is invalid.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new ApiAccessError(400, "invalid_subscription_checkout", `${label} is invalid.`);
  }
  return cleaned;
}

function cleanId(value, label) {
  const cleaned = cleanText(value, label, 200);
  if (!/^[A-Za-z0-9_.:-]+$/.test(cleaned)) {
    throw new ApiAccessError(400, "invalid_subscription_checkout", `${label} is invalid.`);
  }
  return cleaned;
}

function cleanEmail(value) {
  const email = cleanText(value, "Subscription email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiAccessError(400, "invalid_subscription_checkout", "Subscription email is invalid.");
  }
  return email;
}

export function createEmbeddedSubscriptionCheckoutService({ gateway, apiAccessService, priceIds, siteOrigin, enabled = false }) {
  if (!gateway || typeof gateway.createCheckoutSession !== "function") throw new Error("Stripe subscription gateway is required.");
  if (!apiAccessService
    || typeof apiAccessService.getSubscriptionAccount !== "function"
    || typeof apiAccessService.reserveSubscriptionCheckout !== "function") {
    throw new Error("API access service is required.");
  }
  if (typeof siteOrigin !== "string" || !/^https:\/\//.test(siteOrigin)) throw new Error("HTTPS site origin is required.");

  return {
    async createCheckout(input) {
      if (!enabled) throw new ApiAccessError(503, "subscription_checkout_disabled", "API subscription checkout is not enabled.");
      const accountId = cleanId(input.accountId, "Account ID");
      const existing = await apiAccessService.getSubscriptionAccount(accountId);
      if (existing?.stripeSubscriptionId && !REPLACEABLE_SUBSCRIPTION_STATUSES.has(existing.subscriptionStatus)) {
        throw new ApiAccessError(409, "subscription_already_exists", "This account already has a subscription that must be managed instead of replaced.");
      }

      const requestId = cleanId(input.requestId, "Checkout request ID");
      const email = cleanEmail(input.email);
      const plan = getApiPlan(input.plan).name;
      const priceId = priceIds[plan];
      if (typeof priceId !== "string" || !/^price_[A-Za-z0-9]+$/.test(priceId)) {
        throw new ApiAccessError(503, "subscription_price_unavailable", "API subscription pricing is not configured.");
      }

      await apiAccessService.reserveSubscriptionCheckout({ accountId, requestId });
      const session = await gateway.createCheckoutSession({
        accountId,
        requestId,
        email,
        plan,
        priceId,
        customerId: input.customerId ? cleanId(input.customerId, "Stripe customer ID") : undefined,
        returnUrl: `${siteOrigin}/account/api-keys/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      });
      if (!session?.id || typeof session.client_secret !== "string" || !session.client_secret) {
        throw new ApiAccessError(502, "stripe_checkout_unavailable", "Subscription checkout is temporarily unavailable.");
      }
      return { sessionId: session.id, clientSecret: session.client_secret };
    },
  };
}
