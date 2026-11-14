// Merge Governance is sold per developer seat, separately from the API
// plans in plans.js: a pack is not an API plan (no credits, no API keys),
// so it gets its own catalog. The plan keys are the checkout "plan" values
// the site sends; Stripe price IDs are bound to these keys from the
// environment in config.js, never hard-coded here. Amounts are display
// facts mirrored from the Stripe catalog for totals shown before checkout;
// Stripe remains the charging authority.
export const MERGE_GOVERNANCE_PRODUCT = "merge-governance";
export const MERGE_GOVERNANCE_MIN_SEATS = 1;
export const MERGE_GOVERNANCE_MAX_SEATS = 999;

export const MERGE_GOVERNANCE_PLAN_NAMES = Object.freeze([
  "mgov-regular-monthly",
  "mgov-regular-annual",
  "mgov-plus-monthly",
  "mgov-plus-annual",
]);

export const MERGE_GOVERNANCE_PLANS = Object.freeze({
  "mgov-regular-monthly": Object.freeze({
    name: "mgov-regular-monthly",
    pack: "regular",
    interval: "monthly",
    perSeatAmountCents: 2_000,
    currency: "usd",
  }),
  "mgov-regular-annual": Object.freeze({
    name: "mgov-regular-annual",
    pack: "regular",
    interval: "annual",
    perSeatAmountCents: 24_000,
    currency: "usd",
  }),
  "mgov-plus-monthly": Object.freeze({
    name: "mgov-plus-monthly",
    pack: "plus",
    interval: "monthly",
    perSeatAmountCents: 5_000,
    currency: "usd",
  }),
  "mgov-plus-annual": Object.freeze({
    name: "mgov-plus-annual",
    pack: "plus",
    interval: "annual",
    perSeatAmountCents: 60_000,
    currency: "usd",
  }),
});

export function getMergeGovernancePlan(name) {
  const plan = MERGE_GOVERNANCE_PLANS[name];
  if (!plan) throw new Error("Unknown Merge Governance plan.");
  return plan;
}
