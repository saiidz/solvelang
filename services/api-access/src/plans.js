export const API_PLAN_NAMES = Object.freeze(["developer", "pro", "business"]);

export const API_PLANS = Object.freeze({
  developer: Object.freeze({
    name: "developer",
    monthlyRequests: 1_000,
    maxActiveKeys: 2,
    scopes: Object.freeze(["repository:audit"]),
  }),
  pro: Object.freeze({
    name: "pro",
    monthlyRequests: 10_000,
    maxActiveKeys: 3,
    scopes: Object.freeze(["repository:audit"]),
  }),
  business: Object.freeze({
    name: "business",
    monthlyRequests: 50_000,
    maxActiveKeys: 5,
    scopes: Object.freeze(["repository:audit"]),
  }),
});

export function getApiPlan(name) {
  const plan = API_PLANS[name];
  if (!plan) throw new Error("Unknown API subscription plan.");
  return plan;
}

export function usagePeriod(timestamp = Date.now()) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid usage timestamp.");
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
