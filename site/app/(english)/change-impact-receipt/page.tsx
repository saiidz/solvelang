import type { Metadata } from "next";
import { ChangeImpactReceiptApp } from "../../change-impact-receipt/ChangeImpactReceiptApp";

export const metadata: Metadata = {
  title: "Change Impact Receipts for Pull Requests",
  description: "Build a read-only Change Impact Receipt for a public pull request: what it touches, its affected areas, CI and review evidence, and blast radius from the SolveLang PR Gate in report-only mode. Every finding is labeled verified, failed, or unverified with provenance.",
  alternates: { canonical: "https://www.solve-lang.com/change-impact-receipt/" },
};

export default function ChangeImpactReceiptPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 text-center lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang Change Impact Receipts</p>
        <h1 className="mx-auto mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">What a pull request touches, stated with evidence.</h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">Paste the read-only facts for a public pull request — its changed files, check runs, and reviews, plus a SolveLang PR Gate report-only result when you have one — and get a receipt in the format SolveLang uses itself: every finding labeled verified, failed, or unverified, with provenance. Nothing is executed and nothing is posted anywhere.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-muted"><span className="rounded-full border border-line bg-panel px-4 py-2">Read-only</span><span className="rounded-full border border-line bg-panel px-4 py-2">Runs in your browser</span><span className="rounded-full border border-line bg-panel px-4 py-2">No risk scores</span><span className="rounded-full border border-line bg-panel px-4 py-2">Provenance on every finding</span></div>
      </section>
      <ChangeImpactReceiptApp />
    </main>
  );
}
