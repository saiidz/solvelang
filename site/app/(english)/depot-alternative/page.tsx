import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "A Depot Alternative, Priced Plainly",
  description: "Depot charges GitHub’s own $0.006/min headline rate plus a plan fee before the first minute. SolveLang Standard is $0.004/min metered per second, no plan fee, prepaid packs.",
  alternates: { canonical: "https://www.solve-lang.com/depot-alternative/" },
};

export default function Page() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang Depot Alternative</p>
        <h1 className="mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">Depot alternative: read the plan fee before the rate.</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">Depot is a serious runner service. Its pricing has two parts that are easy to miss next to each other: the per-minute rate is GitHub’s own headline rate, and a monthly plan fee is charged before the first minute runs.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">What Depot charges (Depot’s own pricing, read November 28, 2026)</h2>
        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-6 leading-7 text-muted">
          <li>Headline rate: $0.006/min for the base 2 vCPU Linux GitHub Actions runner — the same headline rate as GitHub’s own January 2026 rate card.</li>
          <li>Plan fee before the first minute: Developer is $20/mo and includes 2,000 GitHub Actions minutes; Startup is $200/mo and includes 20,000 minutes.</li>
          <li>Billing granularity, stated precisely: Depot tracks usage by the second, but bills whole minutes at month end, with no one-minute minimum.</li>
        </ul>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">What SolveLang charges</h2>
        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-6 leading-7 text-muted">
          <li>$0.004/min for Standard minutes, metered per second with a 10-second minimum — a 40-second job costs 40 seconds, not a rounded minute.</li>
          <li>No plan fee. Minutes are prepaid packs: 5,000 for $20, 25,000 for $100, 100,000 for $400.</li>
          <li>300 free Standard minutes when you connect GitHub, no card, valid 30 days.</li>
        </ul>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">The same month, both ways</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">Worked example, arithmetic shown: 10,000 minutes of 2 vCPU Linux jobs. Depot Developer: $20 plan + (10,000 − 2,000 included) × $0.006 = $20 + $48 = $68. SolveLang: 10,000 × $0.004 = $40, bought as two 5,000-minute packs or part of a larger pack — and short jobs meter by the second rather than rounding up. Depot may still be the right choice for your team; this page exists so the plan fee and the headline rate are on the table when you decide.</p>

        <p className="mt-10 leading-7 text-muted">Price your own repository’s real runs under both meters: <a href="/ci-bill-check/?utm_source=solve-lang.com&utm_medium=seo&utm_campaign=depot-alternative" className="font-semibold text-accent">the free CI Bill Check</a>. Standard minutes are $0.004/min metered per second (10-second minimum): packs of 5,000 minutes for $20, 25,000 for $100 and 100,000 for $400. Connect GitHub and get 300 free Standard minutes, no card, valid 30 days.</p>
      </section>
    </main>
  );
}
