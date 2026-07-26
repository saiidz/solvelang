import type { Metadata } from 'next';
import Link from "next/link";
import { alternatesForRoute } from "../../i18n/seo";

export const metadata: Metadata = { title: "Workflow Preflight Support — SolveLang", description: "Self-service help for SolveLang Workflow Preflight scanning, checkout, reports, privacy, and refunds.", alternates: alternatesForRoute("support") };

const sections = [
  ["The file will not scan", "Export one n8n workflow as JSON. The file must be non-empty, under 2 MB, and contain a nodes array with no more than 5,000 nodes."],
  ["The score looks lower than expected", "The score uses fixed severity penalties. Disabled triggers, approvals, and error handlers do not satisfy required safeguards."],
  ["Checkout completed but the report is locked", "Return through Stripe's success page in the same browser tab. The pending scan is stored only in session storage. Restart the scan if browser storage was cleared."],
  ["Workflow privacy", "Initial analysis runs in the browser. SolveLang does not execute the workflow or inspect credential values. Checkout sends only an opaque scan ID and minimal consent evidence to the payment service."],
  ["Report limitations", "The report is deterministic structural analysis. It does not guarantee runtime behavior, external API availability, credential correctness, or business-policy compliance."],
];

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <section className="mx-auto max-w-4xl px-6 py-20">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Self-service support</p>
        <h1 className="mt-4 text-4xl font-semibold">Workflow Preflight help</h1>
        <p className="mt-5 text-lg leading-8 text-slate-600">Resolve common scanner, payment, and report issues without waiting for manual support.</p>
        <div className="mt-10 space-y-5">
          {sections.map(([title, body]) => <section key={title} className="rounded-2xl border border-slate-200 p-6"><h2 className="text-xl font-semibold">{title}</h2><p className="mt-3 leading-7 text-slate-600">{body}</p></section>)}
        </div>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link href="/check/" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">Return to scanner</Link>
          <Link href="/billing/" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold">Billing FAQ</Link>
          <Link href="/refund-policy/" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold">Refund Policy</Link>
          <Link href="/terms/" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold">Terms of Use</Link>
        </div>
      </section>
    </main>
  );
}
