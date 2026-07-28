import type { MetadataRoute } from "next";
import { defaultLocale, locales, type LocaleDefinition } from "./locales";
import { pathForLocale, publicRoutes, type PublicRouteSegment } from "./routes";

const origin = "https://www.solve-lang.com";

function absolute(locale: LocaleDefinition, route: PublicRouteSegment): string {
  return new URL(pathForLocale(locale, route), origin).toString();
}

export function alternatesForRoute(
  route: PublicRouteSegment,
  registry: readonly LocaleDefinition[] = locales,
  currentCode: string = defaultLocale.code,
) {
  const reviewed = registry.filter((locale) => locale.publicationState === "reviewed");
  const current = registry.find((locale) => locale.code === currentCode);
  if (!current) throw new Error(`Unknown locale ${currentCode}.`);
  const english = reviewed.find((locale) => locale.code === defaultLocale.code);
  if (!english) throw new Error("The English default locale must remain reviewed.");
  return {
    canonical: absolute(current, route),
    languages: Object.fromEntries([
      ...reviewed.map((locale) => [locale.hreflang, absolute(locale, route)]),
      ["x-default", absolute(english, route)],
    ]),
  };
}

export function sitemapEntries(registry: readonly LocaleDefinition[] = locales): MetadataRoute.Sitemap {
  const reviewed = registry.filter((locale) => locale.publicationState === "reviewed");
  return publicRoutes.flatMap((route) => {
    if (!route.sitemap) return [];
    const routeLocales = route.classification === "localizable-public" ? reviewed : [defaultLocale];
    return routeLocales.map((locale) => ({
      url: absolute(locale, route.segment),
      changeFrequency: route.segment === "" || route.segment === "check" ? "weekly" as const : "monthly" as const,
      priority: route.segment === "" || route.segment === "check" ? 1 : 0.7,
      alternates: route.classification === "localizable-public"
        ? { languages: alternatesForRoute(route.segment, registry, locale.code).languages }
        : undefined,
    }));
  });
}
