// Team Context Index is sold per active team seat, separately from the
// API plans in plans.js and the Merge Governance packs in
// merge-governance-plans.js: a seat is a member record on the hosted
// MCP service's team store (the team owner counts as a seat; revoked
// members persist as records but are never billed). The plan key is
// the checkout "plan" value the site sends; the Stripe price ID is
// bound to the key from the environment in config.js, never hard-coded
// here. The amount is a display fact mirrored from the Stripe catalog
// for totals shown before checkout; Stripe remains the charging
// authority. The $8 seat price is the owner's decision of Nov 24,
// 2026; it clears the measured cost floor under his x2.2 rule.
export const TEAM_CONTEXT_PRODUCT = "team-context-index";
export const TEAM_CONTEXT_MIN_SEATS = 1;
export const TEAM_CONTEXT_MAX_SEATS = 999;

export const TEAM_CONTEXT_PLAN_NAMES = Object.freeze(["team-seat-monthly"]);

export const TEAM_CONTEXT_PLANS = Object.freeze({
  "team-seat-monthly": Object.freeze({
    name: "team-seat-monthly",
    interval: "monthly",
    perSeatAmountCents: 800,
    currency: "usd",
  }),
});

export function getTeamContextPlan(name) {
  const plan = TEAM_CONTEXT_PLANS[name];
  if (!plan) throw new Error("Unknown Team Context Index plan.");
  return plan;
}
