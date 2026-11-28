import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GitHub Actions Alternatives for Cost",
  description: "Cheaper CI than GitHub Actions, in the order to try it: swap the runners first with dated published rates, migrate the platform second with its rewrite cost stated honestly.",
  alternates: { canonical: "https://www.solve-lang.com/github-actions-alternatives/" },
};

export default function Page() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang GitHub Actions Alternatives</p>
        <h1 className="mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">GitHub Actions alternatives, ordered by what they cost to adopt.</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">Most “alternatives” lists start with replacing the whole CI platform. For a bill problem that is the most expensive order to do it in: swapping who runs your existing workflows takes one line, and migrating platforms takes a rewrite. Here is both paths, priced.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Path 1: swap the runners, keep GitHub Actions</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">Every option in this table takes your existing workflows with a change to the runs-on label. Rates are each provider’s own published rate for 2 vCPU Linux, read November 28, 2026; the full dated table, including billing units, is on our runner pricing compared page.</p>
        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-6 leading-7 text-muted">
          <li>Sengi (Basic): $0.001/min, per minute.</li>
          <li>Ubicloud: $0.00125–0.002/min, per minute.</li>
          <li>Latchkey: $0.0025/min, per minute.</li>
          <li>Namespace: $0.002–0.006/min in unit minutes (the shape decides the rate).</li>
          <li>Blacksmith: $0.004/min, per minute, with 3,000 free minutes a month.</li>
          <li>WarpBuild: $0.004/min, per minute.</li>
          <li>SolveLang Standard: $0.004/min, metered per second with a 10-second minimum — the only per-second meter in this table. Nearest exception, stated precisely: Depot tracks usage by the second but bills whole minutes at month end.</li>
          <li>Depot: $0.006/min plus a plan fee ($20/mo Developer including 2,000 minutes; $200/mo Startup including 20,000 minutes).</li>
          <li>GitHub hosted: $0.006/min on the January 2026 rate card, rounded up per job; Windows $0.010/min, macOS $0.062/min.</li>
          <li>RunsOn: no per-minute rate — a flat license from $350/yr plus AWS compute at spot cost in your own account, and a CloudFormation stack to run.</li>
        </ul>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Path 2: migrate the platform — priced honestly</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">GitLab CI, CircleCI, Buildkite, Jenkins and the rest can be the right answer for some teams, but a platform migration is not a label change. Budget for it honestly: every workflow rewritten in a new syntax, every custom action replaced or rebuilt, the team retrained, and the GitHub Actions marketplace — thousands of maintained actions your pipelines already use — left behind. Those are weeks of engineering time before the first cheaper minute is bought, and they are why the runner swap is the first move for a bill problem.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Start with your own numbers</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">A rate table tells you the list price, not your bill: per-job rounding and job shapes decide what you actually pay. Measure first, then choose the swap — one runs-on change, no migration.</p>

        <p className="mt-10 leading-7 text-muted">Price your own repository’s real runs under both meters: <a href="/ci-bill-check/?utm_source=solve-lang.com&utm_medium=seo&utm_campaign=alternatives" className="font-semibold text-accent">the free CI Bill Check</a>. Standard minutes are $0.004/min metered per second (10-second minimum): packs of 5,000 minutes for $20, 25,000 for $100 and 100,000 for $400. Connect GitHub and get 300 free Standard minutes, no card, valid 30 days.</p>
      </section>
    </main>
  );
}
