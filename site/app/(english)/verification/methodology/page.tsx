import type { Metadata } from "next";
import { MethodologyApp } from "../../../verification/methodology/MethodologyApp";

export const metadata: Metadata = {
  title: "How the verification grading works — SolveLang",
  description: "The grading methodology behind SolveLang Verification: the three labels (verified / failed / unverified), what a live run does, how the public proof set was built and what was excluded, how the backtest grades history, and the limits of the evidence.",
  alternates: { canonical: "https://www.solve-lang.com/verification/methodology/" },
};

export default function VerificationMethodologyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 text-center lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang Verification — methodology</p>
        <h1 className="mx-auto mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">How the grading works, stated before the numbers.</h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">The labels, the run, the proof set — including what was excluded from it and why — and the exact definitions the backtest grades under. If a number on the proof page cannot be traced through this page to a run record, it does not belong there.</p>
      </section>
      <MethodologyApp />
    </main>
  );
}
