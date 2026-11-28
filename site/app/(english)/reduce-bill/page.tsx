import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reduce Your GitHub Actions Bill: Measure First",
  description: "How to lower CI costs, in the order that matters: measure the rounding on your real runs first with the free CI Bill Check, delete it with per-second metering, then work the honest generic levers — runner sizing, caching, test selection and batching.",
  alternates: { canonical: "https://www.solve-lang.com/reduce-bill/" },
};

export default function Page() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang Reduce Your GitHub Actions Bill</p>
        <h1 className="mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">Reduce your GitHub Actions bill — measure first, then cut.</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">Most guides to lower CI costs start with tips. This one starts with a measurement, because one part of your bill is not caused by your workflows at all: it is caused by the meter. GitHub rounds every job up to a whole minute. Find out what that costs you, delete it, and only then work the generic levers.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Lever 1: measure your rounding number — then delete it</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">A 12-second job bills as a full minute on GitHub: 60 seconds charged for 12 seconds of work. Across a month of short jobs, the rounded-away seconds are a line item you can measure exactly. The free CI Bill Check reads a public repository&apos;s 10 most recent completed workflow runs — real job seconds — and prices the same work two ways: GitHub&apos;s per-minute rounding, and SolveLang Standard&apos;s per-second metering. The difference on that measured sample is your rounding number. No projections, no estimates: totals over the sample only.</p>
        <p className="mt-4 max-w-3xl leading-7 text-muted">Deleting it does not require changing a single workflow step. SolveLang Standard meters per second with a 10-second minimum, so a 12-second job costs 12 seconds. The rounding line goes to zero because the meter that creates it is gone — that is a structural removal, not an optimisation you have to keep re-earning.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Lever 2: size runners to the job</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">On GitHub&apos;s January 2026 rate card, larger Linux x64 runners run from $0.012/min (4-core) to $0.252/min (96-core), against $0.006/min for the standard 2-core Linux runner. A job that does not parallelise pays the larger rate for cores it never uses. The honest check is per job: if a bigger runner does not finish the job proportionally sooner, the smaller runner is the cheaper minute. Measure job duration on both sizes before switching — the saving is the arithmetic of your own two measurements, nothing promised here.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Lever 3: cache what you rebuild every run</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">Dependency installs and build artefacts that are identical between runs should not be rebuilt on every run. Caching them removes real work, so it lowers the bill under any meter — per-minute or per-second. What it saves is exactly the seconds your jobs stop spending on repeated work, which your own run history shows; beware any guide that quotes you a percentage before measuring your jobs.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Lever 4: run the tests the change can affect</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">A documentation change rarely needs the full suite. Path filters and change-based test selection cut the minutes a run consumes by cutting the work itself. The trade-off is real — selection that is too narrow misses failures — so the honest version of this lever is selective runs on pull requests with a full run on merge, not silent skipping.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Lever 5: batch work that does not need its own run</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">Every workflow run carries fixed overhead: checkout, setup, environment preparation. Batching queued changes into fewer runs — a merge queue is the disciplined form — spreads that overhead across more work. It reduces run count rather than run cost, so it helps most where the fixed overhead is a large share of a short run; on long runs its share is small and the other levers matter more.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">Start with the measurement</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">Levers 2–5 each ask for engineering time and each pays back in proportion to your own numbers. Lever 1 asks for a repository name and pays back a measured figure. Start there.</p>
        <p className="mt-10 leading-7 text-muted">Measure your rounding number free: <a href="/ci-bill-check/?utm_source=solve-lang.com&utm_medium=seo&utm_campaign=reduce-bill" className="font-semibold text-accent">the free CI Bill Check</a>. Standard minutes are $0.004/min metered per second (10-second minimum, fresh machine per job): packs of 5,000 minutes for $20, 25,000 for $100 and 100,000 for $400. Connect GitHub and get 300 free Standard minutes, no card, valid 30 days.</p>
      </section>
    </main>
  );
}
