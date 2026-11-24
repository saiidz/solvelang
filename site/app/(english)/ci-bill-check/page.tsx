import type { Metadata } from "next";
import { CiBillCheckApp } from "../../ci-bill-check/CiBillCheckApp";

export const metadata: Metadata = {
  title: "Free CI Bill Check",
  description: "A free check that reads a public GitHub repository's recent workflow runs and prices the real job seconds two ways: per-minute rounding versus SolveLang Standard's per-second metering. Sample totals only - no projections, no estimates.",
  alternates: { canonical: "https://www.solve-lang.com/ci-bill-check/" },
};

export default function CiBillCheckPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 text-center lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang CI Bill Check</p>
        <h1 className="mx-auto mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">What the rounding does to a CI bill.</h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">Hosted CI is usually billed per minute, rounded up: a 12-second job bills as a full minute. SolveLang Standard meters per second. This free check reads a public repository&apos;s recent workflow runs - real job seconds - and prices the same work under both models, over the stated sample only. No projections, no estimates, and when the data is not there, the page says so instead of inventing figures.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-muted"><span className="rounded-full border border-line bg-panel px-4 py-2">Free</span><span className="rounded-full border border-line bg-panel px-4 py-2">Real run data</span><span className="rounded-full border border-line bg-panel px-4 py-2">Per-second vs per-minute</span><span className="rounded-full border border-line bg-panel px-4 py-2">No projections</span></div>
      </section>
      <CiBillCheckApp />
    </main>
  );
}
