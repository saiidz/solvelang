import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Namespace Pricing, in Plain Minutes",
  description: "Namespace’s unit-minute model explained from its own published pricing: what a unit is, what the GitHub-matching 2 vCPU/8 GB shape really costs prepaid and as overage, and the plain per-second alternative.",
  alternates: { canonical: "https://www.solve-lang.com/namespace-pricing/" },
};

export default function Page() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang Namespace Pricing Explained</p>
        <h1 className="mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">Namespace pricing, in plain minutes.</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">Namespace’s headline $0.002/min is real — for a 2 vCPU machine with 4 GB of RAM. Pricing a real migration means converting unit minutes into the machine you actually run. This page does the conversion from Namespace’s own published pricing.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">The unit minute, in plain terms (Namespace’s own pricing, read November 28, 2026)</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">Namespace does not sell runner minutes. It sells unit minutes: one unit is 1 vCPU with 2 GB of RAM for one minute, multiplied by a platform multiplier — 1 for Linux, 2 for Windows, 10 for macOS. A shape whose memory is larger than 2 GB per vCPU is charged on the larger of cores or half the memory, so memory consumes units too. Namespace’s own worked example: a 4 vCPU Linux instance running 5 minutes is 4 × 5 × 1 = 20 unit minutes.</p>
        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-6 leading-7 text-muted">
          <li>2 vCPU with 4 GB: 2 units per minute — $0.002/min prepaid, $0.003/min overage.</li>
          <li>2 vCPU with 8 GB — the shape that matches a standard GitHub-hosted runner: 4 units per minute — $0.004/min prepaid, $0.006/min overage.</li>
          <li>Plans: Developer is pay as you go at $0; Team is $100/mo including 100,000 unit minutes; Business is $250/mo including 250,000 unit minutes. On the 8 GB shape, the Team plan’s 100,000 unit minutes are 25,000 wall-clock minutes (100,000 ÷ 4).</li>
        </ul>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">The plain-minutes alternative</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">SolveLang Standard sells the minute you were already thinking in: $0.004/min for a fresh runner, metered per second with a 10-second minimum, no unit conversion, no prepaid-versus-overage columns, and no plan required — packs are 5,000 minutes for $20, 25,000 for $100 and 100,000 for $400. At the GitHub-matching shape the prepaid rates are level at $0.004; the difference is the meter and the arithmetic you have to do to read your own bill.</p>

        <p className="mt-10 leading-7 text-muted">Price your own repository’s real runs under both meters: <a href="/ci-bill-check/?utm_source=solve-lang.com&utm_medium=seo&utm_campaign=namespace-pricing" className="font-semibold text-accent">the free CI Bill Check</a>. Standard minutes are $0.004/min metered per second (10-second minimum): packs of 5,000 minutes for $20, 25,000 for $100 and 100,000 for $400. Connect GitHub and get 300 free Standard minutes, no card, valid 30 days.</p>
      </section>
    </main>
  );
}
