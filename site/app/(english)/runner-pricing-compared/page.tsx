import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Runner Pricing Compared",
  description: "Published per-minute rates for hosted GitHub Actions runners, compared like for like (2 vCPU Linux), each dated and sourced — including where SolveLang Standard is not the cheapest, and the one axis where it differs: per-second metering.",
  alternates: { canonical: "https://www.solve-lang.com/runner-pricing-compared/" },
};

const rows = [
  { provider: "Sengi (Basic)", rate: "$0.001", billing: "Per minute" },
  { provider: "Ubicloud", rate: "$0.00125–0.002", billing: "Per minute" },
  { provider: "Latchkey", rate: "$0.0025", billing: "Per minute" },
  { provider: "Namespace", rate: "$0.002–0.006", billing: "Per minute" },
  { provider: "Blacksmith", rate: "$0.004", billing: "Per minute" },
  { provider: "WarpBuild", rate: "$0.004", billing: "Per minute" },
  { provider: "SolveLang Standard", rate: "$0.004", billing: "Per second, 10-second minimum" },
  { provider: "Depot", rate: "$0.006", billing: "Per minute" },
  { provider: "GitHub", rate: "$0.006", billing: "Per minute, rounded up per job" },
];

export default function RunnerPricingComparedPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang Runner Pricing Compared</p>
        <h1 className="mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">Runner pricing, compared honestly.</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">SolveLang is not the cheapest headline rate in this table. It is the only one that meters per second.</p>
        <p className="mt-4 max-w-3xl leading-7 text-muted">Every rate below was read from the provider’s own published pricing page on November 26, 2026. GitHub’s rate is its January 2026 rate card. Rates change; we re-read this table monthly and date every read. This page was published November 28, 2026.</p>
        <div className="mt-10 max-w-4xl overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm leading-6">
            <caption className="pb-3 text-left font-semibold text-ink">Hosted GitHub Actions runners — published rates, 2 vCPU Linux</caption>
            <thead>
              <tr className="border-b border-line text-ink">
                <th scope="col" className="py-2 pr-4 font-semibold">Provider</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Published rate (per minute)</th>
                <th scope="col" className="py-2 font-semibold">Billing</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              {rows.map((row) => (
                <tr key={row.provider} className="border-b border-line">
                  <th scope="row" className="py-2 pr-4 font-semibold text-ink">{row.provider}</th>
                  <td className="py-2 pr-4">{row.rate}</td>
                  <td className="py-2">{row.billing}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm leading-6 text-muted">Billing units as published by each provider, read November 26, 2026; in that read, every provider in this table except SolveLang billed per minute.</p>
        </div>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">The same work, priced</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">100,000 standard Linux minutes at list rate: GitHub $600 — before per-job rounding, which pushes real bills for short jobs higher. SolveLang Standard: $400, the published 100,000-minute pack, metering the seconds each job actually runs.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Self-hosted runners</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">Self-hosted runners cost $0 to GitHub, plus your own machines and their upkeep. GitHub announced a $0.002 per minute self-hosted fee in December 2025 and postponed it before it took effect — it is not in force as of November 2026.</p>
        <p className="mt-10 leading-7 text-muted">Price your own repository’s real runs under both meters: <a href="/ci-bill-check/" className="font-semibold text-accent">the free CI Bill Check</a>.</p>
      </section>
    </main>
  );
}
