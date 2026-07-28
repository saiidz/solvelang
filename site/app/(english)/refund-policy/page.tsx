import type { Metadata } from "next";
import Link from "next/link";
import legalContent from "../../legal-content.json";
import { alternatesForRoute } from "../../i18n/seo";

const refundPolicySections = legalContent.refundPolicy as [string, string[]][];

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "Refund Policy for SolveLang Workflow Preflight digital services.",
  alternates: alternatesForRoute("refund-policy"),
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
          <p className="mt-4 text-base leading-7 text-slate-600">Effective version: {legalContent.termsVersion}. This policy is incorporated into the SolveLang Terms of Use.</p>
        </header>
        <div className="mt-10 space-y-10 leading-7 text-slate-700">
          {refundPolicySections.map(([heading, paragraphs]) => (
            <section key={heading}>
              <h2 className="text-2xl font-semibold tracking-tight">{heading}</h2>
              {paragraphs.map((paragraph) => <p className="mt-4" key={paragraph}>{paragraph}</p>)}
            </section>
          ))}
          <section>
            <h2 className="text-2xl font-semibold tracking-tight">How to request a review</h2>
            <p className="mt-4">Email <a className="font-semibold text-blue-700 underline" href="mailto:hello@solve-lang.com?subject=Refund%20request">hello@solve-lang.com</a> with the payment date, amount, Stripe PaymentIntent or receipt reference, and a short explanation. Do not send full card details, workflow JSON, credentials, or secrets.</p>
            <p className="mt-4">You can submit a withdrawal statement at <Link className="font-semibold text-blue-700 underline" href="/withdraw/">the withdrawal form</Link>. Submission records a request for review and does not itself decide eligibility or promise a refund.</p>
          </section>
        </div>
      </section>
    </main>
  );
}
