import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "Refund Policy for SolveLang Workflow Preflight digital services.",
  alternates: { canonical: "/refund-policy/" },
};

export default function RefundPolicyPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <nav aria-label="Legal navigation" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-blue-700">
          <Link href="/">SolveLang</Link>
          <Link href="/terms/">Terms of Use</Link>
          <Link href="/preflight-privacy/">Workflow Preflight privacy</Link>
          <Link href="/support/">Support</Link>
        </nav>
        <header className="mt-10 border-b border-slate-200 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">SolveLang legal</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Refund Policy</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">Effective version: 2026-07-26. This policy is incorporated into the SolveLang Terms of Use.</p>
        </header>
        <div className="mt-10 space-y-10 leading-7 text-slate-700">
          <section>
            <h2 className="text-2xl font-semibold tracking-tight">Digital service rule</h2>
            <p className="mt-4">All sales are final once automated processing begins or a digital report, entitlement, token, credit, request allowance, or other digital benefit has been generated, consumed, issued, or delivered. Each automated request may immediately consume computing resources, model tokens, third-party API capacity, security verification, and processing capacity that cannot be returned.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold tracking-tight">When refunds may be available</h2>
            <p className="mt-4">Refunds may still be provided for a duplicate charge, a verified technical failure by SolveLang to deliver the purchased service, a fraudulent or unauthorized charge handled under applicable payment rules, a refund required by applicable law, or another exception expressly approved by SolveLang.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold tracking-tight">When refunds are generally not available</h2>
            <p className="mt-4">Refunds are generally not provided for dissatisfaction with an automated finding or score, failure to read product limitations, user error, unsupported or malformed workflows, changing your mind after immediate processing begins, consumed credits, tokens, entitlements, or request allowances, third-party platform failures outside SolveLang&apos;s reasonable control except where law requires otherwise, failure to use a delivered report, or account suspension caused by prohibited conduct.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold tracking-tight">How to request a review</h2>
            <p className="mt-4">Email <a className="font-semibold text-blue-700 underline" href="mailto:hello@solve-lang.com?subject=Refund%20request">hello@solve-lang.com</a> with the payment date, amount, Stripe PaymentIntent or receipt reference, and a short explanation. Do not send full card details, workflow JSON, credentials, or secrets.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold tracking-tight">EU and EEA consumer information</h2>
            <p className="mt-4">Consumers may normally have statutory withdrawal rights. At checkout, you expressly request immediate performance and delivery of the digital service and acknowledge that the withdrawal right may be lost when digital performance or delivery begins following express consent and acknowledgment. Mandatory consumer rights remain unaffected; this policy does not state an absolute waiver where applicable law does not permit one.</p>
          </section>
        </div>
      </section>
    </main>
  );
}
