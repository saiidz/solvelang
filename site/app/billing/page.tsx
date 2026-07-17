import type { Metadata } from "next";
export const metadata: Metadata = { title: "Billing FAQ — SolveLang", description: "Billing and payment answers for SolveLang Workflow Preflight." };
const items=[
  ["How is payment handled?","Stripe Checkout processes payment. SolveLang does not receive or store full card details."],
  ["What does one purchase unlock?","One successful checkout unlocks the complete report for the matching scan ID. Entitlements are short-lived and bound to the Stripe Checkout session."],
  ["Why did checkout not unlock another scan?","Entitlements are intentionally bound to one opaque scan ID to prevent replay across unrelated reports."],
  ["Are subscriptions active?","No. Workflow Preflight v1 uses a one-time payment. Subscription plans require a separate launch decision."],
  ["Will I receive a receipt?","Stripe sends the receipt when receipt email is enabled in the Stripe account and the customer supplies an email during checkout."],
];
export default function Page(){return <main className="min-h-screen bg-white text-slate-900"><section className="mx-auto max-w-4xl px-6 py-20"><h1 className="text-4xl font-semibold">Billing FAQ</h1><div className="mt-10 space-y-5">{items.map(([q,a])=><section key={q} className="rounded-2xl border border-slate-200 p-6"><h2 className="text-xl font-semibold">{q}</h2><p className="mt-3 leading-7 text-slate-600">{a}</p></section>)}</div></section></main>}
