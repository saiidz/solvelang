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
      <section className="mx-auto max-w-6xl px-6 pb-12 lg:px-8" aria-labelledby="bill-why-heading">
        <h2 id="bill-why-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">Why is my GitHub Actions bill so high?</h2>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-muted">Two meters set the bill: the per-minute rate and the number of minutes rounding creates. GitHub rounds every job up to a whole minute, so a 12-second job bills as 60 seconds. This check prices your real recent runs under both models — GitHub’s rounding and SolveLang’s per-second metering — over the measured sample only.</p>
        <div className="mt-8 max-w-3xl overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm leading-6">
            <caption className="pb-3 text-left font-semibold text-ink">GitHub-hosted runner rates — per minute, standard runners</caption>
            <thead>
              <tr className="border-b border-line text-ink">
                <th scope="col" className="py-2 pr-4 font-semibold">Runner</th>
                <th scope="col" className="py-2 font-semibold">Rate</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-line"><th scope="row" className="py-2 pr-4 font-semibold text-ink">Linux (2-core)</th><td className="py-2">$0.006/min</td></tr>
              <tr className="border-b border-line"><th scope="row" className="py-2 pr-4 font-semibold text-ink">Windows (2-core)</th><td className="py-2">$0.010/min</td></tr>
              <tr><th scope="row" className="py-2 pr-4 font-semibold text-ink">macOS</th><td className="py-2">$0.062/min</td></tr>
            </tbody>
          </table>
          <p className="mt-3 text-sm leading-6 text-muted">GitHub’s published per-minute rates for standard GitHub-hosted runners — GitHub’s pricing reference, January 2026 rate card; read November 28, 2026.</p>
        </div>
      </section>
      <CiBillCheckApp />
    </main>
  );
}
