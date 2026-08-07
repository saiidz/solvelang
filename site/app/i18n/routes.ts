import { defaultLocale, localeForSegment, locales, type LocaleDefinition } from "./locales";

export const publicRoutes = [
  { segment: "", classification: "localizable-public", sitemap: true },
  { segment: "about", classification: "localizable-public", sitemap: true },
  { segment: "support", classification: "localizable-public", sitemap: true },
  { segment: "billing", classification: "localizable-public", sitemap: true },
  { segment: "refunds", classification: "localizable-public", sitemap: true },
  { segment: "terms", classification: "localizable-public", sitemap: true },
  { segment: "refund-policy", classification: "localizable-public", sitemap: true },
  { segment: "preflight-privacy", classification: "localizable-public", sitemap: true },
  { segment: "withdraw", classification: "localizable-public", sitemap: false },
  { segment: "resources", classification: "localizable-public", sitemap: true },
  { segment: "pricing", classification: "localizable-public", sitemap: true },
  { segment: "api-pricing", classification: "english-only-technical", sitemap: false },
  { segment: "n8n-workflow-validator", classification: "localizable-public", sitemap: true },
  { segment: "n8n-workflow-tester", classification: "localizable-public", sitemap: true },
  { segment: "n8n-error-checker", classification: "localizable-public", sitemap: true },
  { segment: "n8n-security-scanner", classification: "localizable-public", sitemap: true },
  { segment: "n8n-workflow-documentation-generator", classification: "localizable-public", sitemap: true },
  { segment: "run", classification: "english-only-technical", sitemap: true },
  { segment: "repository-audit", classification: "english-only-technical", sitemap: true },
  { segment: "check", classification: "english-only-technical", sitemap: true },
  { segment: "status", classification: "english-only-technical", sitemap: true },
  { segment: "demo/support-triage", classification: "english-only-technical", sitemap: true },
  { segment: "checkout", classification: "checkout-sensitive", sitemap: false },
  { segment: "success", classification: "noindex-utility", sitemap: false },
  { segment: "studio", classification: "english-only-technical", sitemap: true },
  { segment: "audit", classification: "noindex-utility", sitemap: false },
  { segment: "landing", classification: "disabled", sitemap: false },
] as const;
export type PublicRouteSegment = (typeof publicRoutes)[number]["segment"];
export const localizableRoutes = publicRoutes.filter((route) => route.classification === "localizable-public").map((route) => route.segment);

const unsafeQueryKeys = new Set([
  "client_secret", "payment_intent_client_secret", "payment_intent", "session_id", "entitlement", "token", "scan_id", "email", "receipt", "workflow", "report",
]);

export function normalisePublicRoute(route: readonly string[] | undefined): PublicRouteSegment | undefined {
  if (!route || route.length === 0) return "";
  const segment = route.join("/");
  return publicRoutes.some((candidate) => candidate.segment === segment) ? segment as PublicRouteSegment : undefined;
}

export function pathForLocale(locale: LocaleDefinition, route: PublicRouteSegment): string {
  const suffix = route ? `/${route}` : "";
  return locale.code === defaultLocale.code ? `${suffix ? `${suffix}/` : "/"}` : `/${locale.segment}${suffix}/`;
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
  return publicRoutes.find((candidate) => candidate.segment === route)?.classification === "checkout-sensitive"
    || route === "success";
}

function routeForPathname(pathname: string): PublicRouteSegment | undefined {
  const parts = pathname.split("/").filter(Boolean);
  return normalisePublicRoute(localeForSegment(parts[0]) ? parts.slice(1) : parts);
}

export function isLanguageSuggestionEligiblePath(pathname: string): boolean {
  const route = routeForPathname(pathname);
  return route !== undefined
    && publicRoutes.find((candidate) => candidate.segment === route)?.classification === "localizable-public";
}

export function canApplyLanguageSuggestion(requestPath: string, currentPath: string): boolean {
  return requestPath === currentPath && isLanguageSuggestionEligiblePath(currentPath);
}

export function draftPreviewEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.I18N_DRAFT_PREVIEW === "true";
}

export function productionLocalizedParams(preview = draftPreviewEnabled()) {
  return (locales as readonly LocaleDefinition[])
    .filter((locale) => locale.code !== defaultLocale.code && (locale.publicationState === "reviewed" || (preview && locale.publicationState === "draft")))
    .flatMap((locale) => localizableRoutes.map((route) => ({ locale: locale.segment, route: route ? route.split("/") : [] })));
}
