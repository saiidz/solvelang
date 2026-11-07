import { ApiAccessError } from "./service.js";
import {
  MERGE_GOVERNANCE_MAX_SEATS,
  MERGE_GOVERNANCE_MIN_SEATS,
  MERGE_GOVERNANCE_PRODUCT,
  getMergeGovernancePlan,
} from "./merge-governance-plans.js";

// This service is the Merge Governance twin of
// elements-subscription-checkout.js: same reservation discipline, same
// promotion-code handling, same incomplete-subscription creation and
// response shape. The deliberate differences are the catalog (per-seat
// packs instead of API plans), the seat quantity, and the absence of the
// API-plan already-subscribed block — an API subscription lives on the
// account record and must never block a different product's purchase.
// Merge Governance subscriptions are tagged with the product metadata
// marker so the API-plan lifecycle acknowledges and skips their webhook
// events instead of failing on an unrecognized price.
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

function logMergeGovernanceFailure(logger, error) {
  try {
    const record = {
      type: "stripe_checkout_error",
      operation: "merge_governance_subscription_create",
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
  if (typeof value !== "string") throw new ApiAccessError(400, "invalid_merge_governance_checkout", `${label} is invalid.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new ApiAccessError(400, "invalid_merge_governance_checkout", `${label} is invalid.`);
  }
  return cleaned;
}

function cleanId(value, label) {
  const cleaned = cleanText(value, label, 200);
  if (!/^[A-Za-z0-9_.:-]+$/.test(cleaned)) {
    throw new ApiAccessError(400, "invalid_merge_governance_checkout", `${label} is invalid.`);
  }
  return cleaned;
}

function cleanEmail(value) {
  const email = cleanText(value, "Subscription email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiAccessError(400, "invalid_merge_governance_checkout", "Subscription email is invalid.");
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
  if (value === undefined || value === null) return 1;
  if (!Number.isSafeInteger(value) || value < MERGE_GOVERNANCE_MIN_SEATS || value > MERGE_GOVERNANCE_MAX_SEATS) {
    throw new ApiAccessError(400, "invalid_merge_governance_checkout", "Seat quantity is invalid.");
  }
  return value;
}

function cleanPlan(value) {
  try {
    return getMergeGovernancePlan(value);
  } catch {
    throw new ApiAccessError(400, "invalid_merge_governance_checkout", "Merge Governance plan is invalid.");
  }
}

export function createMergeGovernanceCheckoutService({ gateway, apiAccessService, priceIds, enabled = false, logger = console }) {
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

  return {
    async createMergeGovernanceCheckout(input) {
      if (!enabled) throw new ApiAccessError(503, "merge_governance_checkout_disabled", "Merge Governance checkout is not enabled.");
      const accountId = cleanId(input.accountId, "Account ID");
      const requestId = cleanId(input.requestId, "Checkout request ID");
      const email = cleanEmail(input.email);
      const plan = cleanPlan(input.plan);
      const priceId = priceIds?.[plan.name];
      if (typeof priceId !== "string" || !/^price_[A-Za-z0-9]+$/.test(priceId)) {
        throw new ApiAccessError(503, "merge_governance_price_unavailable", "Merge Governance pricing is not configured.");
      }
      const quantity = cleanQuantity(input.quantity);

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
          product: MERGE_GOVERNANCE_PRODUCT,
          customerId: input.customerId ? cleanId(input.customerId, "Stripe customer ID") : undefined,
          promotionCodeId,
        });
      } catch (error) {
        await apiAccessService.releaseSubscriptionCheckout({ accountId, requestId }).catch(() => {});
        logMergeGovernanceFailure(logger, error);
        throw error;
      }
      if (!created?.subscriptionId || typeof created.customerId !== "string" || !created.customerId) {
        await apiAccessService.releaseSubscriptionCheckout({ accountId, requestId }).catch(() => {});
        throw new ApiAccessError(502, "stripe_checkout_unavailable", "Subscription checkout is temporarily unavailable.");
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
