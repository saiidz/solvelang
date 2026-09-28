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

export function persistApiCheckoutRequestId(
  location: { pathname: string; search: string; hash: string },
  history: { state: unknown; replaceState(state: unknown, title: string, url: string): void },
  createRequestId: () => string,
): string {
  const params = new URLSearchParams(location.search);
  const existing = params.get("request_id");
  if (existing) return existing;

  const requestId = createRequestId();
  params.set("request_id", requestId);
  history.replaceState(history.state, "", `${location.pathname}?${params.toString()}${location.hash}`);
  return requestId;
}
