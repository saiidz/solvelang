import { ApiAccessError } from "./service.js";
import {
  TEAM_CONTEXT_MAX_SEATS,
  TEAM_CONTEXT_MIN_SEATS,
  TEAM_CONTEXT_PRODUCT,
  getTeamContextPlan,
} from "./team-context-plans.js";

// This service is the Team Context Index twin of
// merge-governance-checkout.js: same reservation discipline, same
// promotion-code handling, same incomplete-subscription creation and
// response shape. The deliberate differences are the catalog (a single
// per-seat plan instead of packs), the team id carried in the
// subscription metadata, and the team -> subscription record written
// on success so seat-count sync can find the subscription when team
// membership changes.
//
// There is deliberately NO paywall here: a team keeps working exactly
// as before whether or not it ever subscribes. This service only
// sells the subscription; nothing in the team surface reads it.
const STRIPE_ERROR_TYPES = new Set([
  "StripeInvalidRequestError", "StripeAuthenticationError", "StripePermissionError",
  "StripeAPIError", "StripeConnectionError", "StripeRateLimitError", "StripeIdempotencyError", "StripeCardError",
]);
const STRIPE_ERROR_CODES = new Set([
  "parameter_invalid_enum", "parameter_missing", "parameter_unknown", "parameters_exclusive",
  "url_invalid", "resource_missing", "api_key_expired", "account_invalid", "secret_key_required",
  "testmode_charges_only", "livemode_mismatch", "rate_limit", "idempotency_key_in_use",
  "promotion_code_invalid", "promotion_code_max_redemptions_reached", "coupon_expired",
]);

function logTeamContextFailure(logger, error) {
  try {
    const record = {
      type: "stripe_checkout_error",
      operation: "team_context_subscription_create",
      stripeType: STRIPE_ERROR_TYPES.has(error?.type) ? error.type : "unknown",
    };
    if (STRIPE_ERROR_CODES.has(error?.code)) record.stripeCode = error.code;
    if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599) {
      record.statusCode = error.statusCode;
    }
    if (typeof error?.requestId === "string" && /^req_[A-Za-z0-9]{1,64}$/.test(error.requestId)) {
      record.stripeRequestId = error.requestId;
    }
    logger.error(record);
  } catch {
    // Diagnostics must not replace the original failure or affect reservation cleanup.
  }
}

function cleanText(value, label, maximum = 254) {
  if (typeof value !== "string") throw new ApiAccessError(400, "invalid_team_context_checkout", `${label} is invalid.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new ApiAccessError(400, "invalid_team_context_checkout", `${label} is invalid.`);
  }
  return cleaned;
}

function cleanId(value, label) {
  const cleaned = cleanText(value, label, 200);
  if (!/^[A-Za-z0-9_.:-]+$/.test(cleaned)) {
    throw new ApiAccessError(400, "invalid_team_context_checkout", `${label} is invalid.`);
  }
  return cleaned;
}

function cleanEmail(value) {
  const email = cleanText(value, "Subscription email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiAccessError(400, "invalid_team_context_checkout", "Subscription email is invalid.");
  }
  return email;
}

function cleanPromotionCode(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const code = cleanText(value, "Promotion code", 64);
  if (!/^[A-Za-z0-9_-]+$/.test(code)) {
    throw new ApiAccessError(400, "promotion_code_invalid", "Promotion code is invalid.");
  }
  return code;
}

function cleanQuantity(value) {
  if (!Number.isSafeInteger(value) || value < TEAM_CONTEXT_MIN_SEATS || value > TEAM_CONTEXT_MAX_SEATS) {
    throw new ApiAccessError(400, "invalid_team_context_checkout", "Seat quantity is invalid.");
  }
  return value;
}

const BILLING_ADDRESS_FIELD_LIMITS = { line1: 200, line2: 200, city: 100, state: 100, postalCode: 32 };

// The billing address is optional end to end, exactly as in the Merge
// Governance checkout: without it the checkout keeps its pre-tax
// behavior (no automatic tax, no customer writes); when present the
// country is required and every other field is optional and capped.
function cleanBillingAddress(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiAccessError(400, "invalid_team_context_checkout", "Billing address is invalid.");
  }
  const country = cleanText(value.country, "Billing country", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new ApiAccessError(400, "invalid_team_context_checkout", "Billing country is invalid.");
  }
  const address = { country };
  for (const [field, maximum] of Object.entries(BILLING_ADDRESS_FIELD_LIMITS)) {
    const raw = value[field];
    if (raw === undefined || raw === null || raw === "") continue;
    address[field] = cleanText(raw, "Billing address", maximum);
  }
  return address;
}

function cleanTaxId(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return cleanText(value, "Tax ID", 64);
}

function cleanPlan(value) {
  try {
    return getTeamContextPlan(value);
  } catch {
    throw new ApiAccessError(400, "invalid_team_context_checkout", "Team Context Index plan is invalid.");
  }
}

export function createTeamContextCheckoutService({ gateway, apiAccessService, priceId, teamContextStore, enabled = false, logger = console, now = Date.now }) {
  if (!gateway
    || typeof gateway.findPromotionCode !== "function"
    || typeof gateway.createIncompleteSubscription !== "function") {
    throw new Error("Stripe subscription gateway is required.");
  }
  if (!apiAccessService
    || typeof apiAccessService.reserveSubscriptionCheckout !== "function"
    || typeof apiAccessService.releaseSubscriptionCheckout !== "function") {
    throw new Error("API access service is required.");
  }
  if (!teamContextStore || typeof teamContextStore.recordTeamSubscription !== "function") {
    throw new Error("Team context store is required.");
  }

  return {
    async createTeamContextCheckout(input) {
      if (!enabled) throw new ApiAccessError(503, "team_context_checkout_disabled", "Team Context Index checkout is not enabled.");
      const accountId = cleanId(input.accountId, "Account ID");
      const requestId = cleanId(input.requestId, "Checkout request ID");
      const email = cleanEmail(input.email);
      const plan = cleanPlan(input.plan);
      if (typeof priceId !== "string" || !/^price_[A-Za-z0-9]+$/.test(priceId)) {
        throw new ApiAccessError(503, "team_context_price_unavailable", "Team Context Index pricing is not configured.");
      }
      const teamId = cleanId(input.teamId, "Team ID");
      const quantity = cleanQuantity(input.quantity);
      const billingAddress = cleanBillingAddress(input.billingAddress);
      const taxId = cleanTaxId(input.taxId);

      const promotionCode = cleanPromotionCode(input.promotionCode);
      let promotionCodeId;
      if (promotionCode) {
        promotionCodeId = await gateway.findPromotionCode(promotionCode);
        if (!promotionCodeId) {
          throw new ApiAccessError(400, "promotion_code_invalid", "Promotion code is invalid.");
        }
      }

      await apiAccessService.reserveSubscriptionCheckout({ accountId, requestId });
      let created;
      try {
        created = await gateway.createIncompleteSubscription({
          accountId,
          requestId,
          email,
          plan: plan.name,
          priceId,
          quantity,
          product: TEAM_CONTEXT_PRODUCT,
          subscriptionMetadata: { teamId },
          customerId: input.customerId ? cleanId(input.customerId, "Stripe customer ID") : undefined,
          promotionCodeId,
          ...(billingAddress ? {
            automaticTax: true,
            taxDetails: { billingAddress, ...(taxId ? { taxId } : {}) },
          } : {}),
        });
      } catch (error) {
        await apiAccessService.releaseSubscriptionCheckout({ accountId, requestId }).catch(() => {});
        logTeamContextFailure(logger, error);
        throw error;
      }
      if (!created?.subscriptionId || typeof created.customerId !== "string" || !created.customerId) {
        await apiAccessService.releaseSubscriptionCheckout({ accountId, requestId }).catch(() => {});
        throw new ApiAccessError(502, "stripe_checkout_unavailable", "Subscription checkout is temporarily unavailable.");
      }
      // Remember which subscription belongs to this team so seat sync
      // can find it later. A recording failure never fails the
      // checkout the customer just started; it is logged, and the
      // mapping can be repaired by a later checkout for the team.
      try {
        await teamContextStore.recordTeamSubscription({
          teamId,
          accountId,
          subscriptionId: created.subscriptionId,
          customerId: created.customerId,
          seats: quantity,
          updatedAt: now(),
        });
      } catch (error) {
        try { logger.error({ type: "team_context_record_failed", teamId, subscriptionId: created.subscriptionId }); } catch {}
      }
      if (created.paymentRequired) {
        if (typeof created.clientSecret !== "string" || !created.clientSecret) {
          throw new ApiAccessError(502, "stripe_checkout_unavailable", "Subscription checkout is temporarily unavailable.");
        }
        return {
          subscriptionId: created.subscriptionId,
          customerId: created.customerId,
          paymentRequired: true,
          clientSecret: created.clientSecret,
        };
      }
      return {
        subscriptionId: created.subscriptionId,
        customerId: created.customerId,
        paymentRequired: false,
      };
    },
  };
}
