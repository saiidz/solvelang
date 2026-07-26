import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Refund Access After Payment",
  description: "Technical access behavior after a SolveLang Workflow Preflight refund.",
};

export default function Page() {
  return <main className="min-h-screen bg-white text-slate-900"><section className="mx-auto max-w-3xl px-6 py-20"><h1 className="text-4xl font-semibold">Refund access after payment</h1><p className="mt-6 leading-7 text-slate-600">For customer refund terms, eligibility, and consumer information, read the <Link className="font-medium text-blue-700 underline" href="/refund-policy/">SolveLang Refund Policy</Link>.</p><div className="mt-8 space-y-6 leading-7 text-slate-600"><p>Approved full refunds prevent that payment from receiving or renewing report access. A signed entitlement issued before the refund may remain active until its current expiration, for no more than 15 minutes.</p><p>A partial refund does not revoke report access because the payment has not been fully refunded. Contact us if the partial-refund amount or remaining access is unexpected.</p><p>Duplicate and suspected fraudulent charges are reviewed against Stripe&apos;s payment and refund records, which remain the payment source of truth.</p><p>Include the Stripe receipt email, approximate payment time, and the last four characters of the PaymentIntent ID when contacting <span className="font-medium text-slate-900">hello@solve-lang.com</span>. Never email workflow JSON, credentials, card numbers, or secrets.</p></div></section></main>;
}
