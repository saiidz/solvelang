import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GitHub Actions Minutes Cost: The January 2026 Rate Card",
  description: "What GitHub Actions minutes actually cost: the full dated January 2026 rate card including larger runners, the dollar-denominated included compute since October 28, 2026, and the rounding math on a worked month.",
  alternates: { canonical: "https://www.solve-lang.com/minutes-cost/" },
};

export default function Page() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang GitHub Actions Minutes Cost</p>
        <h1 className="mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">GitHub Actions minutes cost, on the dated rate card.</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">GitHub Actions pricing is a per-minute rate card plus one rule: every job is rounded up to a whole minute. This page publishes the full January 2026 card, the included compute in the dollars GitHub now denominates it in, and the rounding arithmetic on a worked month — then prices the same minutes the SolveLang way.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">The full rate card — GitHub Actions minutes pricing, January 2026</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">GitHub&apos;s published per-minute rates for GitHub-hosted runners — GitHub&apos;s pricing reference, January 2026 rate card; read November 28, 2026.</p>
        <div className="mt-6 max-w-3xl overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm leading-6">
            <caption className="pb-3 text-left font-semibold text-ink">GitHub-hosted runner rates — per minute</caption>
            <thead>
              <tr className="border-b border-line text-ink">
                <th scope="col" className="py-2 pr-4 font-semibold">Runner</th>
                <th scope="col" className="py-2 font-semibold">Rate</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-line"><th scope="row" className="py-2 pr-4 font-semibold text-ink">Linux (2-core)</th><td className="py-2">$0.006/min</td></tr>
              <tr className="border-b border-line"><th scope="row" className="py-2 pr-4 font-semibold text-ink">Windows (2-core)</th><td className="py-2">$0.010/min</td></tr>
              <tr className="border-b border-line"><th scope="row" className="py-2 pr-4 font-semibold text-ink">macOS</th><td className="py-2">$0.062/min</td></tr>
              <tr><th scope="row" className="py-2 pr-4 font-semibold text-ink">Larger Linux x64 runners</th><td className="py-2">$0.012/min (4-core) to $0.252/min (96-core)</td></tr>
            </tbody>
          </table>
          <p className="mt-3 text-sm leading-6 text-muted">Larger runners scale with core count: the published Linux x64 larger-runner range runs from $0.012/min at 4 cores to $0.252/min at 96 cores on the same January 2026 card. Every job on every runner is rounded up to a whole minute.</p>
        </div>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Included compute is dollars now — since October 28, 2026</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">Since October 28, 2026, GitHub denominates the compute included with each plan in dollars per month, not in minutes: $12 on Free, $18 on Pro and Team, and $300 on Enterprise Cloud (GitHub Docs, read November 28, 2026). What that dollar amount buys depends on which runners spend it — at the standard Linux rate of $0.006/min, $18 of included compute is 3,000 Linux minutes ($18 ÷ $0.006 = 3,000); spent on macOS at $0.062/min it is about 290 minutes. The old per-plan free-minutes framing no longer describes the card without this dollar context.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">The rounding math, on a worked month</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">A worked example with every input stated, so you can replace it with your own: a repository runs 6,000 Linux jobs in a month, averaging 30 seconds of work per job.</p>
        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-6 leading-7 text-muted">
          <li>Actual work: 6,000 jobs × 30 seconds = 180,000 seconds = 3,000 minutes of work.</li>
          <li>GitHub bills each job rounded up to a whole minute: 6,000 jobs × 1 billed minute = 6,000 billed minutes.</li>
          <li>GitHub&apos;s bill for that month: 6,000 × $0.006 = $36. Of that, the rounding alone is 3,000 minutes × $0.006 = $18 — half the bill buys no work.</li>
          <li>The same 180,000 seconds on SolveLang Standard, metered per second at $0.004/min: 3,000 minutes × $0.004 = $12.</li>
        </ul>
        <p className="mt-4 max-w-3xl leading-7 text-muted">Your month will differ — job count and average job length are the whole story. That is why the check below measures your real runs instead of projecting from an example.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Price your own minutes both ways</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">Two free ways in, both on the CI Bill Check: type the minutes from your own GitHub bill for an estimate on this rate card, or name a public repository and have its 10 most recent real runs priced under both meters — GitHub&apos;s rounding and SolveLang Standard&apos;s per-second metering — over the measured sample only.</p>
        <p className="mt-10 leading-7 text-muted">Run it now: <a href="/ci-bill-check/?utm_source=solve-lang.com&utm_medium=seo&utm_campaign=minutes-cost" className="font-semibold text-accent">the free CI Bill Check</a>. Standard minutes are $0.004/min metered per second (10-second minimum, fresh machine per job): packs of 5,000 minutes for $20, 25,000 for $100 and 100,000 for $400. Connect GitHub and get 300 free Standard minutes, no card, valid 30 days.</p>
      </section>
    </main>
  );
}
