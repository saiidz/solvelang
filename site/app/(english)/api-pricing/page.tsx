import type { Metadata } from "next";
import Link from "next/link";
import { accountAvailability, billingAvailability } from "../../product-capabilities";
import { JsonLd } from "../../components/JsonLd";
export const metadata: Metadata = { title: "API Pricing", description: "Compare SolveLang Developer, Pro, and Business monthly weighted-credit API plans." };
const plans = [
  { name: "Developer", key: "developer", price: "$49", description: "For prototypes, internal tools, and early repository-audit integrations.", credits: "1,000", keys: "2", highlighted: false },
  { name: "Pro", key: "pro", price: "$199", description: "For larger test workloads and teams evaluating monthly API capacity.", credits: "10,000", keys: "3", highlighted: true },
  { name: "Business", key: "business", price: "$699", description: "For teams evaluating higher-volume audits across multiple services.", credits: "50,000", keys: "5", highlighted: false },
] as const;
const apiPlansJsonLd = {
  "@context": "https://schema.org",
  "@type": "Product",
  "@id": "https://www.solve-lang.com/api-pricing/#api-plans",
  name: "SolveLang API Access Plans",
  description:
    "Monthly weighted-credit API plans for the SolveLang API and repository-audit integrations. One base credit covers up to 5,000 input tokens and 1,000 output tokens; larger jobs consume multiple credits, and every plan has a hard monthly limit. Subscriptions renew monthly until canceled.",
  brand: { "@id": "https://www.solve-lang.com/#organization" },
  offers: plans.map((plan) => ({
    "@type": "Offer",
    name: `${plan.name} API plan`,
    price: plan.price.replace("$", ""),
    priceCurrency: "USD",
    description: `${plan.description} ${plan.credits} weighted credits per UTC calendar month \u00b7 ${plan.keys} active API keys. Price is per month.`,
    availability: "https://schema.org/InStock",
    url: "https://www.solve-lang.com/api-pricing/",
  })),
};

const runnerMinutesJsonLd = {
  "@context": "https://schema.org",
  "@type": "Product",
  "@id": "https://www.solve-lang.com/api-pricing/#runner-minutes",
  name: "SolveLang Runner Minutes",
  description:
    "Prepaid GitHub Actions runner minutes. Buy a pack once, connect GitHub, and queued jobs run on fresh SolveLang-provisioned Linux machines \u2014 metered per second from each job's own start and finish, Spot at 1\u00d7 with on-demand minutes drawn at 2\u00d7 as a separate line. Runner-minutes prices include tax. The full runner-minutes shelf is published on the services page.",
  brand: { "@id": "https://www.solve-lang.com/#organization" },
  category: "GitHub Actions runner minutes",
  offers: [
    { "@type": "Offer", name: "5,000 Standard runner minutes", price: "20", priceCurrency: "USD", availability: "https://schema.org/InStock", url: "https://www.solve-lang.com/services/" },
    { "@type": "Offer", name: "25,000 Standard runner minutes", price: "100", priceCurrency: "USD", availability: "https://schema.org/InStock", url: "https://www.solve-lang.com/services/" },
    { "@type": "Offer", name: "100,000 Standard runner minutes", price: "400", priceCurrency: "USD", availability: "https://schema.org/InStock", url: "https://www.solve-lang.com/services/" },
    { "@type": "AggregateOffer", name: "High-Power runner minutes", lowPrice: "80", highPrice: "400", priceCurrency: "USD", offerCount: 10, url: "https://www.solve-lang.com/services/" },
  ],
};

const apiPricingFaqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": "https://www.solve-lang.com/api-pricing/#faq",
  mainEntity: [
    {
      "@type": "Question",
      name: "What does one API credit cover?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "One base credit covers up to 5,000 input tokens and 1,000 output tokens. Larger jobs consume multiple credits, and every plan has a hard monthly limit.",
      },
    },
    {
      "@type": "Question",
      name: "What do the SolveLang API plans cost?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Developer is $49 per month, with 1,000 weighted credits per UTC calendar month and 2 active API keys. Pro is $199 per month, with 10,000 weighted credits per UTC calendar month and 3 active API keys. Business is $699 per month, with 50,000 weighted credits per UTC calendar month and 5 active API keys.",
      },
    },
    {
      "@type": "Question",
      name: "Do API subscriptions renew automatically?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Subscriptions renew monthly until canceled. Schedule cancellation in your subscription account to stop renewal at the current period end.",
      },
    },
    {
      "@type": "Question",
      name: "What do runner minutes cost?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Standard packs: 5,000 minutes $20, 25,000 minutes $100, 100,000 minutes $400. High-Power packs run from 1,000 minutes at $80 to 10,000 minutes at $400, and the Speed Lane Cache is $2 per month. Runner-minutes prices include tax. Minutes are metered per second from each job's own start and finish, Spot at 1\u00d7 with on-demand minutes drawn at 2\u00d7 as a separate line.",
      },
    },
  ],
};

export default function ApiPricingPage() {
  return (
    <main className="min-h-screen bg-canvas px-6 py-16 text-ink">
      <JsonLd id="api-plans-json-ld" data={apiPlansJsonLd} />
      <JsonLd id="api-pricing-runner-minutes-json-ld" data={runnerMinutesJsonLd} />
      <JsonLd id="api-pricing-faq-json-ld" data={apiPricingFaqJsonLd} />
      <div className="mx-auto max-w-6xl">
        <header className="mx-auto max-w-3xl py-12 text-center"><p className="text-sm font-semibold uppercase tracking-[0.25em] text-accent">SolveLang API</p><h1 className="mt-5 text-5xl font-bold tracking-tight md:text-7xl">Pay for measured work, not an uncapped AI request.</h1><p className="mt-6 text-lg leading-8 text-body">One base credit covers up to 5,000 input tokens and 1,000 output tokens. Larger jobs consume multiple credits.</p></header>
        <section className="mb-10 rounded-3xl border border-warning bg-warning-soft p-8" aria-labelledby="api-subscription-availability"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-warning">Availability</p><h2 id="api-subscription-availability" className="mt-3 text-2xl font-bold">API subscription availability</h2><p className="mt-3 max-w-4xl leading-7 text-body">{billingAvailability}</p><p className="mt-3 text-sm leading-6 text-body">Subscriptions renew monthly until canceled. UPCOMINGSOUNDS S.R.L. is the operator and merchant; Stripe processes payments. Review the amount and any tax or other charge Stripe actually displays at checkout before confirming payment. Schedule cancellation in your subscription account to stop renewal at the current period end. Review <Link className="font-semibold text-ink underline" href="/terms/">Terms</Link>, <Link className="font-semibold text-ink underline" href="/refund-policy/">Refund Policy</Link>, and <Link className="font-semibold text-ink underline" href="/billing/">Billing FAQ</Link> before purchase.</p></section>
        <section className="grid gap-6 md:grid-cols-3">{plans.map((plan) => <article key={plan.key} className={plan.highlighted ? "rounded-3xl border-2 border-accent bg-accent-soft p-7 shadow-2xl shadow-cyan-950/30" : "rounded-3xl border border-line bg-panel p-7"}><p className="text-xs font-semibold uppercase tracking-wider text-accent">API plan</p><h2 className="mt-5 text-3xl font-bold">{plan.name}</h2><p className="mt-3 min-h-20 text-sm leading-6 text-body">{plan.description}</p><p className="mt-6 text-4xl font-bold">{plan.price}<span className="text-base font-medium text-muted">/month</span></p><div className="mt-6 border-y border-line py-6"><p className="text-4xl font-bold">{plan.credits}</p><p className="mt-1 text-sm text-muted">weighted credits per UTC calendar month</p></div><ul className="mt-6 space-y-3 text-sm text-body"><li>{plan.keys} active API keys</li><li>5,000 input + 1,000 output tokens per credit</li><li>Repository audit scope</li><li>Hard monthly credit limit</li><li>One-time secret reveal and key revocation</li></ul><Link href={`/account/api-keys/?plan=${plan.key}`} className="mt-8 block rounded-xl border border-line-strong px-5 py-3 text-center font-bold hover:bg-panel">View {plan.name}</Link></article>)}</section>
        <section className="mt-10 rounded-3xl border border-line bg-panel p-8" aria-labelledby="runner-minutes-pricing"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Runner minutes · Live</p><h2 id="runner-minutes-pricing" className="mt-3 text-2xl font-bold">Prepaid GitHub Actions runner minutes</h2><p className="mt-3 max-w-4xl leading-7 text-body">Buy a pack once, connect GitHub, and queued jobs run on fresh SolveLang-provisioned Linux machines — metered per second from each job&apos;s own start and finish, Spot at 1x with on-demand minutes drawn at 2x as a separate line. Standard packs: 5,000 minutes $20 · 25,000 minutes $100 · 100,000 minutes $400. High-Power packs run from 1,000 minutes at $80 to 10,000 minutes at $400, and the Speed Lane Cache is $2 per month. Runner-minutes prices include tax.</p><p className="mt-4 flex flex-wrap gap-x-6 gap-y-2"><Link href="/services/" className="font-semibold text-ink underline">See the full runner-minutes shelf</Link><Link href="/account/runner-minutes-checkout/" className="font-semibold text-ink underline">Buy runner minutes</Link></p></section>
        <section className="mt-10 rounded-3xl border border-fuchsia-300/20 bg-fuchsia-300/5 p-8"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-fuchsia-200">Priority processing</p><h2 className="mt-3 text-3xl font-bold">Paid priority remains gated.</h2><p className="mt-4 max-w-4xl leading-7 text-body">Express, Priority, and Critical lanes require verified queue-backed worker behavior and separate enablement. Queue infrastructure alone does not establish a purchasable service.</p></section>
        <section className="mt-10 rounded-3xl border border-line bg-panel p-8"><h2 className="text-2xl font-bold">Account access and credit controls</h2><p className="mt-3 max-w-4xl leading-7 text-body">{accountAvailability}</p><p className="mt-3 max-w-4xl leading-7 text-body">Subscription purchase, account, and API-key controls are separate surfaces. Current entitlement and feature gates still govern which operations an account may perform.</p></section>
      </div>
    </main>
  );
}
