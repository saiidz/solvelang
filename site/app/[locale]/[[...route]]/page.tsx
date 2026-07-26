import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dictionaryFor } from "../../i18n/dictionaries";
import { localeForSegment, locales } from "../../i18n/locales";
import { normalisePublicRoute, pathForLocale, publicRouteSegments, type PublicRouteSegment } from "../../i18n/routes";

type Props = { params: Promise<{ locale: string; route?: string[] }> };

function routeTitle(route: PublicRouteSegment, dictionary: ReturnType<typeof dictionaryFor>): string {
  return route === "" ? "SolveLang" : dictionary[route === "refund-policy" ? "refundPolicy" : route === "preflight-privacy" ? "privacy" : route] ?? "SolveLang";
}

export function generateStaticParams() {
  return locales.filter((locale) => locale.code !== "en").flatMap((locale) => publicRouteSegments.map((route) => ({ locale: locale.segment, route: route ? [route] : [] })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: segment, route: routeParts } = await params;
  const locale = localeForSegment(segment);
  const route = normalisePublicRoute(routeParts);
  if (!locale || route === undefined) return {};
  const dictionary = dictionaryFor(locale.code as never);
  const canonical = `https://www.solve-lang.com${pathForLocale(locale, route)}`;
  return {
    title: `${routeTitle(route, dictionary)} | SolveLang`,
    description: dictionary.draftNotice,
    alternates: { canonical },
    robots: { index: false, follow: true },
    openGraph: { title: `${routeTitle(route, dictionary)} | SolveLang`, description: dictionary.draftNotice, url: canonical, locale: locale.code },
    twitter: { card: "summary", title: `${routeTitle(route, dictionary)} | SolveLang`, description: dictionary.draftNotice },
  };
}

export default async function LocalizedPublicPage({ params }: Props) {
  const { locale: segment, route: routeParts } = await params;
  const locale = localeForSegment(segment);
  const route = normalisePublicRoute(routeParts);
  if (!locale || route === undefined || locale.code === "en") notFound();
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
