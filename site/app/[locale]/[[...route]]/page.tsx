import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dictionaryFor } from "../../i18n/dictionaries";
import { localeForSegment } from "../../i18n/locales";
import { alternatesForRoute } from "../../i18n/seo";
import { draftPreviewEnabled, normalisePublicRoute, pathForLocale, productionLocalizedParams, type PublicRouteSegment } from "../../i18n/routes";

type Props = { params: Promise<{ locale: string; route?: string[] }> };

function routeTitle(route: PublicRouteSegment, dictionary: ReturnType<typeof dictionaryFor>): string {
  const translated = {
    support: dictionary.support,
    terms: dictionary.terms,
    "refund-policy": dictionary.refundPolicy,
    "preflight-privacy": dictionary.privacy,
    withdraw: dictionary.withdraw,
  } as Partial<Record<PublicRouteSegment, string>>;
  return route === "" ? "SolveLang" : translated[route] ?? route.split("-").map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}

export function generateStaticParams() {
  const params = productionLocalizedParams();
  return params.length > 0 ? params : [{ locale: "__i18n_disabled__", route: [] }];
}

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: segment, route: routeParts } = await params;
  if (segment === "__i18n_disabled__") return { robots: { index: false, follow: false } };
  const locale = localeForSegment(segment);
  const route = normalisePublicRoute(routeParts);
  if (!locale || route === undefined) return {};
  const dictionary = dictionaryFor(locale.code as never);
  const alternates = alternatesForRoute(route, undefined, locale.code);
  return {
    title: `${routeTitle(route, dictionary)} | SolveLang`,
    description: dictionary.draftNotice,
    alternates,
    robots: { index: locale.publicationState === "reviewed", follow: true },
    openGraph: { title: `${routeTitle(route, dictionary)} | SolveLang`, description: dictionary.draftNotice, url: alternates.canonical, locale: locale.code },
    twitter: { card: "summary", title: `${routeTitle(route, dictionary)} | SolveLang`, description: dictionary.draftNotice },
  };
}

export default async function LocalizedPublicPage({ params }: Props) {
  const { locale: segment, route: routeParts } = await params;
  if (segment === "__i18n_disabled__") {
    return <main aria-hidden="true" className="hidden">Localized routes are not published.</main>;
  }
  const locale = localeForSegment(segment);
  const route = normalisePublicRoute(routeParts);
  if (!locale || route === undefined || locale.code === "en" || (locale.publicationState !== "reviewed" && !draftPreviewEnabled())) notFound();
  const dictionary = dictionaryFor(locale.code as never);
  const checkoutBlocked = route === "checkout" || route === "check";
  return <main lang={locale.code} dir={locale.direction} className="min-h-screen bg-slate-50 px-6 py-14 text-slate-950 sm:py-20">
    <article className="mx-auto max-w-3xl space-y-7 leading-7 text-slate-700">
      <nav aria-label="Localized public navigation" className="flex flex-wrap gap-4 text-sm font-semibold text-blue-700">
        <Link href={pathForLocale(locale, "")}>{dictionary.home}</Link>
        <Link href={pathForLocale(locale, "support")}>{dictionary.support}</Link>
        <Link href={pathForLocale(locale, "terms")}>{dictionary.terms}</Link>
        <Link href="/">English</Link>
      </nav>
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{dictionary.draftNotice}</p>
      <h1 className="text-4xl font-semibold tracking-tight text-slate-950">{routeTitle(route, dictionary)}</h1>
      {checkoutBlocked ? <p>{dictionary.checkoutUnavailable}</p> : <>
        <p>{dictionary.paymentSummary}</p>
        <p>{dictionary.withdrawal}</p>
        <p>{dictionary.contact}: <a className="font-semibold text-blue-700 underline" href="mailto:hello@solve-lang.com"><bdi>hello@solve-lang.com</bdi></a></p>
      </>}
      <p className="font-mono text-sm" dir="ltr">SolveLang · Workflow Preflight · USD $49</p>
    </article>
  </main>;
}
