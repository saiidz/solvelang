import { ApiAccessError } from "./service.js";
import { getApiPlan } from "./plans.js";

const SUPPORTED_SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);
const SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due", "canceled", "unpaid", "incomplete"]);

function cleanText(value, label, maximum = 254) {
  if (typeof value !== "string") throw new ApiAccessError(400, "invalid_subscription_event", `${label} is invalid.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new ApiAccessError(400, "invalid_subscription_event", `${label} is invalid.`);
  }
  return cleaned;
}

function cleanId(value, label) {
  const cleaned = cleanText(value, label, 200);
  if (!/^[A-Za-z0-9_.:-]+$/.test(cleaned)) throw new ApiAccessError(400, "invalid_subscription_event", `${label} is invalid.`);
  return cleaned;
}

function cleanEmail(value) {
  const email = cleanText(value, "Subscription email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiAccessError(400, "invalid_subscription_event", "Subscription email is invalid.");
  }
  return email;
}

function planForPrice(priceId, priceIds) {
  const match = Object.entries(priceIds).find(([, configured]) => configured === priceId);
  if (!match) throw new ApiAccessError(400, "unknown_subscription_price", "Subscription price is not recognized.");
  getApiPlan(match[0]);
  return match[0];
}

function subscriptionObject(event) {
  const subscription = event?.data?.object;
  if (!subscription || typeof subscription !== "object") {
    throw new ApiAccessError(400, "invalid_subscription_event", "Subscription event is invalid.");
  }
  return subscription;
}

function subscriptionPriceId(subscription) {
  const items = subscription?.items?.data;
  if (!Array.isArray(items) || items.length !== 1) {
    throw new ApiAccessError(400, "invalid_subscription_items", "Subscription must contain exactly one API plan.");
  }
  return cleanId(items[0]?.price?.id, "Subscription price ID");
}

export function createSubscriptionCheckoutService({ gateway, priceIds, siteOrigin, enabled = false }) {
  if (!gateway || typeof gateway.createCheckoutSession !== "function") throw new Error("Stripe subscription gateway is required.");
  if (typeof siteOrigin !== "string" || !siteOrigin) throw new Error("Site origin is required.");

  return {
    async createCheckout(input) {
      if (!enabled) throw new ApiAccessError(503, "subscription_checkout_disabled", "API subscription checkout is not enabled.");
      const accountId = cleanId(input.accountId, "Account ID");
      const email = cleanEmail(input.email);
      const plan = getApiPlan(input.plan).name;
      const priceId = priceIds[plan];
      if (typeof priceId !== "string" || !/^price_[A-Za-z0-9]+$/.test(priceId)) {
        throw new ApiAccessError(503, "subscription_price_unavailable", "API subscription pricing is not configured.");
      }
      const session = await gateway.createCheckoutSession({
        accountId,
        email,
        plan,
        priceId,
        customerId: input.customerId ? cleanId(input.customerId, "Stripe customer ID") : undefined,
        successUrl: `${siteOrigin}/account/api-keys/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${siteOrigin}/api-pricing/?checkout=canceled`,
      });
      if (!session?.id || !session?.url) throw new ApiAccessError(502, "stripe_checkout_unavailable", "Subscription checkout is temporarily unavailable.");
      return { sessionId: session.id, url: session.url };
    },
  };
}

export function createSubscriptionLifecycleService({ apiAccessService, eventStore, priceIds, gracePeriodMs = 3 * 24 * 60 * 60 * 1_000 }) {
  if (!apiAccessService || typeof apiAccessService.provisionSubscription !== "function") throw new Error("API access service is required.");
  if (!eventStore || typeof eventStore.putEventIfAbsent !== "function") throw new Error("Subscription event store is required.");
  if (!Number.isSafeInteger(gracePeriodMs) || gracePeriodMs < 0) throw new Error("Grace period is invalid.");

  return {
    async processEvent(event) {
      const eventId = cleanId(event?.id, "Stripe event ID");
      const eventType = cleanText(event?.type, "Stripe event type", 100);
      if (!SUPPORTED_SUBSCRIPTION_EVENTS.has(eventType)) return { handled: false, duplicate: false };
      if (!Number.isSafeInteger(event?.created) || event.created <= 0) {
        throw new ApiAccessError(400, "invalid_subscription_event", "Stripe event timestamp is invalid.");
      }

      const subscription = subscriptionObject(event);
      const metadata = subscription.metadata ?? {};
      const accountId = cleanId(metadata.accountId, "Account ID");
      const email = cleanEmail(metadata.email);
      const customerId = cleanId(typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id, "Stripe customer ID");
      const subscriptionId = cleanId(subscription.id, "Stripe subscription ID");
      const plan = planForPrice(subscriptionPriceId(subscription), priceIds);
      const rawStatus = eventType === "customer.subscription.deleted" ? "canceled" : cleanText(subscription.status, "Subscription status", 32);
      if (!SUBSCRIPTION_STATUSES.has(rawStatus)) {
        throw new ApiAccessError(400, "invalid_subscription_status", "Subscription status is invalid.");
      }
      if (!Number.isSafeInteger(subscription.current_period_end) || subscription.current_period_end <= 0) {
        throw new ApiAccessError(400, "invalid_subscription_period", "Subscription period is invalid.");
      }
      const createdAtMs = event.created * 1_000;
      const account = await apiAccessService.provisionSubscription({
        accountId,
        email,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        plan,
        subscriptionStatus: rawStatus,
        currentPeriodEnd: subscription.current_period_end * 1_000,
        ...(rawStatus === "past_due" ? { graceUntil: createdAtMs + gracePeriodMs } : {}),
      });
      const duplicate = await eventStore.putEventIfAbsent({
        eventId,
        eventType,
        subscriptionId,
        accountId,
        createdAt: new Date(createdAtMs).toISOString(),
        expiresAt: Math.floor(createdAtMs / 1_000) + 60 * 60 * 24 * 400,
      }) === "duplicate";
      return { handled: true, duplicate, account };
    },
  };
}
