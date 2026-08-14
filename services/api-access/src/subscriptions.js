import { createHash, randomUUID } from "node:crypto";
import { ApiAccessError } from "./service.js";
import { getApiPlan } from "./plans.js";

const SUPPORTED_SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);
const SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due", "canceled", "unpaid", "incomplete"]);
const REPLACEABLE_SUBSCRIPTION_STATUSES = new Set(["canceled", "unpaid"]);
const STATUS_ORDER = Object.freeze({ trialing: 1, active: 2, incomplete: 4, past_due: 6, unpaid: 8, canceled: 9 });
const PLAN_RESTRICTIVENESS = Object.freeze({ business: 1, pro: 2, developer: 3 });
const DEFAULT_EVENT_LEASE_MS = 60_000;

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

function subscriptionItem(subscription) {
  const items = subscription?.items?.data;
  if (!Array.isArray(items) || items.length !== 1) {
    throw new ApiAccessError(400, "invalid_subscription_items", "Subscription must contain exactly one API plan.");
  }
  const item = items[0];
  const priceId = cleanId(item?.price?.id, "Subscription price ID");
  if (!Number.isSafeInteger(item?.current_period_end) || item.current_period_end <= 0) {
    throw new ApiAccessError(400, "invalid_subscription_period", "Subscription period is invalid.");
  }
  return { priceId, currentPeriodEnd: item.current_period_end };
}

function eventOrder(created, status, plan) {
  const order = created * 1_000 + STATUS_ORDER[status] * 10 + PLAN_RESTRICTIVENESS[plan];
  if (!Number.isSafeInteger(order)) throw new ApiAccessError(400, "invalid_subscription_event", "Subscription event order is invalid.");
  return order;
}

function payloadFingerprint(parts) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

function eventRecord({
  eventId,
  eventType,
  subscriptionId,
  accountId,
  createdAtMs,
  payloadFingerprint: fingerprint,
}) {
  return {
    eventId,
    eventType,
    subscriptionId,
    accountId,
    payloadFingerprint: fingerprint,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: Math.floor(createdAtMs / 1_000) + 60 * 60 * 24 * 400,
  };
}

function subscriptionConflict(existing, subscriptionId, incomingStatus) {
  if (!existing?.stripeSubscriptionId || existing.stripeSubscriptionId === subscriptionId) return false;
  return !REPLACEABLE_SUBSCRIPTION_STATUSES.has(existing.subscriptionStatus)
    || REPLACEABLE_SUBSCRIPTION_STATUSES.has(incomingStatus);
}

export function createSubscriptionCheckoutService({ gateway, apiAccessService, priceIds, siteOrigin, enabled = false }) {
  if (!gateway || typeof gateway.createCheckoutSession !== "function") throw new Error("Stripe subscription gateway is required.");
  if (!apiAccessService
    || typeof apiAccessService.getSubscriptionAccount !== "function"
    || typeof apiAccessService.reserveSubscriptionCheckout !== "function") {
    throw new Error("API access service is required.");
  }
  if (typeof siteOrigin !== "string" || !siteOrigin) throw new Error("Site origin is required.");

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
        successUrl: `${siteOrigin}/account/api-keys/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${siteOrigin}/api-pricing/?checkout=canceled`,
      });
      if (!session?.id || !session?.url) throw new ApiAccessError(502, "stripe_checkout_unavailable", "Subscription checkout is temporarily unavailable.");
      return { sessionId: session.id, url: session.url };
    },
  };
}

export function createSubscriptionLifecycleService({
  apiAccessService,
  eventStore,
  gateway,
  priceIds,
  gracePeriodMs = 3 * 24 * 60 * 60 * 1_000,
  eventLeaseMs = DEFAULT_EVENT_LEASE_MS,
  now = Date.now,
  claimToken = randomUUID,
}) {
  if (!apiAccessService || typeof apiAccessService.provisionSubscription !== "function" || typeof apiAccessService.getSubscriptionAccount !== "function") {
    throw new Error("API access service is required.");
  }
  if (!eventStore
    || typeof eventStore.claimEvent !== "function"
    || typeof eventStore.completeEvent !== "function"
    || typeof eventStore.releaseEvent !== "function") {
    throw new Error("Subscription event store is required.");
  }
  if (gateway && typeof gateway.normalizeSuccessfulSubscriptionPaymentMethod !== "function") {
    throw new Error("Stripe subscription gateway is invalid.");
  }
  if (!Number.isSafeInteger(gracePeriodMs) || gracePeriodMs < 0) throw new Error("Grace period is invalid.");
  if (!Number.isSafeInteger(eventLeaseMs) || eventLeaseMs < 1_000 || eventLeaseMs > 15 * 60 * 1_000) {
    throw new Error("Subscription event lease is invalid.");
  }
  if (typeof now !== "function" || typeof claimToken !== "function") throw new Error("Subscription event clock and claim-token source are required.");

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
      const item = subscriptionItem(subscription);
      const plan = planForPrice(item.priceId, priceIds);
      const rawStatus = eventType === "customer.subscription.deleted" ? "canceled" : cleanText(subscription.status, "Subscription status", 32);
      if (!SUBSCRIPTION_STATUSES.has(rawStatus)) {
        throw new ApiAccessError(400, "invalid_subscription_status", "Subscription status is invalid.");
      }
      const createdAtMs = event.created * 1_000;
      const fingerprint = payloadFingerprint([
        eventId,
        eventType,
        String(event.created),
        accountId,
        email,
        customerId,
        subscriptionId,
        item.priceId,
        String(item.currentPeriodEnd),
        rawStatus,
      ]);
      const record = eventRecord({
        eventId,
        eventType,
        subscriptionId,
        accountId,
        createdAtMs,
        payloadFingerprint: fingerprint,
      });
      const processingStartedAt = now();
      if (!Number.isSafeInteger(processingStartedAt) || processingStartedAt <= 0) throw new Error("Subscription event clock is invalid.");
      const token = claimToken();
      if (typeof token !== "string" || !token || token.length > 200) throw new Error("Subscription event claim token is invalid.");
      const claim = await eventStore.claimEvent(record, {
        claimToken: token,
        now: Math.floor(processingStartedAt / 1_000),
        leaseUntil: Math.floor((processingStartedAt + eventLeaseMs) / 1_000),
        claimedAt: new Date(processingStartedAt).toISOString(),
      });
      if (claim === "duplicate") return { handled: true, duplicate: true };
      if (claim === "busy") {
        throw new ApiAccessError(503, "subscription_event_in_progress", "Subscription event processing is temporarily busy.");
      }
      if (claim !== "claimed") {
        throw new ApiAccessError(409, "subscription_event_conflict", "Subscription event identity conflicts with an existing record.");
      }

      let completed = false;
      try {
        const existing = await apiAccessService.getSubscriptionAccount(accountId);
        if (subscriptionConflict(existing, subscriptionId, rawStatus)
          || (existing?.stripeSubscriptionId === subscriptionId && existing.subscriptionStatus === "canceled" && rawStatus !== "canceled")) {
          const completion = await eventStore.completeEvent({
            eventId,
            payloadFingerprint: fingerprint,
            claimToken: token,
            completedAt: new Date(now()).toISOString(),
          });
          if (completion !== "completed") {
            throw new ApiAccessError(503, "subscription_event_lease_lost", "Subscription event processing must be retried.");
          }
          completed = true;
          return { handled: true, duplicate: false, ignored: "subscription_conflict", account: existing };
        }

        const account = await apiAccessService.provisionSubscription({
          accountId,
          email,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          plan,
          subscriptionStatus: rawStatus,
          currentPeriodEnd: item.currentPeriodEnd * 1_000,
          subscriptionEventCreatedAt: createdAtMs,
          subscriptionEventOrder: eventOrder(event.created, rawStatus, plan),
          ...(rawStatus === "past_due" ? { graceUntil: createdAtMs + gracePeriodMs } : {}),
        });
        if ((rawStatus === "active" || rawStatus === "trialing") && gateway) {
          await gateway.normalizeSuccessfulSubscriptionPaymentMethod({ customerId, subscriptionId, eventId });
        }
        const completion = await eventStore.completeEvent({
          eventId,
          payloadFingerprint: fingerprint,
          claimToken: token,
          completedAt: new Date(now()).toISOString(),
        });
        if (completion !== "completed") {
          throw new ApiAccessError(503, "subscription_event_lease_lost", "Subscription event processing must be retried.");
        }
        completed = true;
        return { handled: true, duplicate: false, account };
      } catch (error) {
        if (!completed) {
          try {
            await eventStore.releaseEvent({
              eventId,
              payloadFingerprint: fingerprint,
              claimToken: token,
              releasedAt: new Date(now()).toISOString(),
            });
          } catch {
            // A retryable lease or a newer claimant remains authoritative if release also fails.
          }
        }
        throw error;
      }
    },
  };
}
