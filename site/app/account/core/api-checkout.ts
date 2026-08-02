export type ApiPlanKey = "developer" | "pro" | "business";

export type ApiCheckoutStart =
  | { kind: "existing-subscription" }
  | { kind: "choose-plan" }
  | { kind: "checkout"; plan: ApiPlanKey };

function isApiPlan(value: string | null): value is ApiPlanKey {
  return value === "developer" || value === "pro" || value === "business";
}

export function resolveApiCheckoutStart(
  currentPlan: ApiPlanKey | null | undefined,
  requestedPlan: string | null,
): ApiCheckoutStart {
  if (currentPlan) return { kind: "existing-subscription" };
  if (!isApiPlan(requestedPlan)) return { kind: "choose-plan" };
  return { kind: "checkout", plan: requestedPlan };
}
