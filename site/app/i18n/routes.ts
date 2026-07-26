import { defaultLocale, localeForSegment, type LocaleDefinition } from "./locales";

export const publicRouteSegments = ["", "check", "checkout", "support", "preflight-privacy", "terms", "refund-policy", "withdraw"] as const;
export type PublicRouteSegment = (typeof publicRouteSegments)[number];

const unsafeQueryKeys = new Set([
  "client_secret", "payment_intent_client_secret", "payment_intent", "session_id", "entitlement", "token", "scan_id", "email", "receipt", "workflow", "report",
]);

export function normalisePublicRoute(route: readonly string[] | undefined): PublicRouteSegment | undefined {
  if (!route || route.length === 0) return "";
  if (route.length !== 1) return undefined;
  return publicRouteSegments.includes(route[0] as PublicRouteSegment) ? route[0] as PublicRouteSegment : undefined;
}

export function pathForLocale(locale: LocaleDefinition, route: PublicRouteSegment): string {
  const suffix = route ? `/${route}` : "";
  return locale.code === defaultLocale.code ? `${suffix || "/"}` : `/${locale.segment}${suffix}/`;
}

export function safeLocalePath(locale: LocaleDefinition, pathname: string, query: URLSearchParams = new URLSearchParams()): string {
  const parts = pathname.split("/").filter(Boolean);
  const route = normalisePublicRoute(localeForSegment(parts[0]) ? parts.slice(1) : parts);
  if (route === undefined) return pathForLocale(locale, "");
  const safe = new URLSearchParams();
  for (const [key, value] of query) {
    if (!unsafeQueryKeys.has(key) && key === "ref") safe.set(key, value);
  }
  const search = safe.toString();
  return `${pathForLocale(locale, route)}${search ? `?${search}` : ""}`;
}

export function isPaymentSensitiveRoute(route: PublicRouteSegment): boolean {
  return route === "checkout" || route === "check";
}
