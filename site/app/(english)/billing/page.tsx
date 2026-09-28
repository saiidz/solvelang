import type { Metadata } from "next";
import Link from "next/link";
import { alternatesForRoute } from "../../i18n/seo";
import { billingAvailability } from "../../product-capabilities";

export const metadata: Metadata = {
  title: "Billing FAQ",
  description: "Billing, renewal, and cancellation answers for SolveLang API subscriptions.",
  alternates: alternatesForRoute("billing"),
};

const items = [
  ["Who bills me?", "UPCOMINGSOUNDS S.R.L. is the SolveLang operator and merchant. Stripe processes subscription payments; your statement may show UPCOMINGSOUNDS S.R.L."],
  ["Which API plans are offered?", "Developer is $49/month, Pro is $199/month, and Business is $699/month before any applicable tax or adjustments shown at checkout. Plan credits, key limits, and repository-audit scope are listed on API Pricing."],
  ["When does a subscription renew or cancel?", "API subscriptions renew monthly until canceled. In your subscription account you can schedule cancellation for the end of the current billing period. Access until then remains subject to subscription status and entitlement gates. Scheduling cancellation does not automatically refund a paid period."],
  ["Does an API plan include paid priority or provider execution?", "No. Paid priority lanes, provider-backed execution, and general managed workflow execution have separate gates."],
  ["How are refunds reviewed?", "Contact hello@solve-lang.com about a duplicate or unauthorized charge, a service-delivery problem, or a statutory remedy. The Refund Policy explains the review route; mandatory consumer rights remain unaffected."],
  ["What about Workflow Preflight?", "Workflow Preflight is a separate one-time digital-report product. Its checkout remains subject to its own delivery and confirmation gates; the API subscription rollout does not enable it."],
] as const;

export default function Page() {
  return <main className="min-h-screen bg-white text-slate-900"><section className="mx-auto max-w-4xl px-6 py-20"><h1 className="text-4xl font-semibold">Billing FAQ</h1><p className="mt-6 leading-7 text-slate-600">{billingAvailability}</p><div className="mt-10 space-y-5">{items.map(([question, answer]) => <section key={question} className="rounded-2xl border border-slate-200 p-6"><h2 className="text-xl font-semibold">{question}</h2><p className="mt-3 leading-7 text-slate-600">{answer}</p></section>)}</div><p className="mt-8 leading-7 text-slate-600">Review <Link className="font-semibold text-blue-700 underline" href="/api-pricing/">API Pricing</Link>, <Link className="font-semibold text-blue-700 underline" href="/terms/">Terms of Use</Link>, and the <Link className="font-semibold text-blue-700 underline" href="/refund-policy/">Refund Policy</Link> before purchase. For help, <Link className="font-semibold text-blue-700 underline" href="/support/">contact support</Link>.</p></section></main>;
}
