import type { Metadata } from "next";
import { auditStats, ciChipGroups, classifiedCard, compatExplainer, landingOutcomes, processSteps, rulesLines, scoreboardMetrics, testChips, testChipsLabel } from "./process-solution-data";

export const metadata: Metadata = {
  title: "Process Solution",
  description: "Merge governance for GitHub teams: test the combined landing tree once, merge only what was tested, and prove the savings. Your code never leaves your infrastructure.",
};

export default function ProcessSolutionPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="border-b border-slate-200 pb-8">
          <p className="text-sm font-semibold text-blue-700">SolveLang Process Solution</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Test the landing tree once. Merge only what was tested.</h1>
          <p className="mt-5 max-w-3xl leading-7 text-slate-600">
            Process Solution is a merge-governance control plane for GitHub teams. It builds the exact tree that will land — base plus batch together — runs one capped battery on it, and lands that tree only on FULL GREEN. Every decision is written to an audit log, and the savings are proved on a scoreboard your team can read.
          </p>
        </div>

        <section className="mt-8 rounded-3xl bg-slate-950 p-7 text-white" aria-labelledby="wall-heading">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">The wall</p>
          <h2 id="wall-heading" className="mt-3 text-2xl font-semibold">Your code never leaves your infrastructure.</h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
            The control plane sees webhooks, PR metadata and test results — never a checkout. Your repositories, your code, and your self-hosted runners stay inside your world; SolveLang orchestrates the queue from metadata alone. That is the whole security story, and it stays literally true.
          </p>
        </section>

        <section className="mt-12" aria-labelledby="how-heading">
          <h2 id="how-heading" className="text-2xl font-semibold">How it works</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">From install to landed code, the same five steps run for every batch.</p>
          <ol className="mt-6 grid gap-5 sm:grid-cols-2">
            {processSteps.map((step, index) => (
              <li key={step.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">Step {index + 1}</p>
                <h3 className="mt-3 text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {landingOutcomes.map((outcome) => (
              <article
                key={outcome.heading}
                className={outcome.tone === "green" ? "rounded-3xl border border-emerald-200 bg-emerald-50 p-6" : "rounded-3xl border border-rose-200 bg-rose-50 p-6"}
              >
                <h3 className="text-lg font-semibold">{outcome.heading}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-700">{outcome.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-12" aria-labelledby="compat-heading">
          <h2 id="compat-heading" className="text-2xl font-semibold">Works with the checks you already run</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{compatExplainer}</p>
          {ciChipGroups.map((group) => (
            <div key={group.label} className="mt-6">
              <h3 className="text-sm font-semibold">{group.label}</h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {group.chips.map((chip) => (
                  <li
                    key={chip}
                    className={
                      group.tier === "proven"
                        ? "rounded-full bg-blue-700 px-4 py-2 text-sm font-semibold text-white"
                        : "rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
                    }
                  >
                    {chip}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="mt-6">
            <h3 className="text-sm font-semibold">{testChipsLabel}</h3>
            <ul className="mt-3 flex flex-wrap gap-2">
              {testChips.map((chip) => (
                <li key={chip} className="rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-sm text-slate-700">
                  {chip}
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-6 max-w-3xl text-sm leading-6 text-slate-600">
            Don&apos;t see your CI? If it reports checks or commit statuses to GitHub, it works. If it doesn&apos;t, tell us —{" "}
            <a href="mailto:hello@solve-lang.com" className="font-semibold text-blue-700">
              hello@solve-lang.com
            </a>
            .
          </p>
        </section>

        <section className="mt-12" aria-labelledby="proof-heading">
          <h2 id="proof-heading" className="text-2xl font-semibold">Proof, measured — not promised</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Every number below was measured on the owner&apos;s own production queue in the Nov 3–6, 2026 audit. Design partner number one is our own companies; the queue that produced these numbers runs under these same rules today.
          </p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {auditStats.map((stat) => (
              <article key={stat.label} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-4xl font-semibold tracking-tight">{stat.value}</p>
                <h3 className="mt-3 text-sm font-semibold">{stat.label}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{stat.note}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-12" aria-labelledby="rules-heading">
          <h2 id="rules-heading" className="text-2xl font-semibold">The rules are readable on purpose</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Governance lives in plain lines your team can read in review — not in a black box. This is the proven starting template, the same shape that governs our own queue:
          </p>
          <div className="mt-6 rounded-3xl bg-slate-950 p-7 text-white">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">merge-rules.solve</p>
            <pre className="mt-4 whitespace-pre-wrap break-words font-mono text-sm leading-7 text-slate-100">{rulesLines.join("\n")}</pre>
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">
            Every cap in this template is a recommendation, not a lock — your team configures stack size, shard caps, batch size and gate strictness to your own queue. The floor that never moves: fail-closed on unresolvable state, a written reason for every merge and block, and your code never leaves your infrastructure.
          </p>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">
            The rules are the readable part. The product is that they are enforced on every landing — and that every enforcement is audited.
          </p>
        </section>

        <section className="mt-12" aria-labelledby="audit-heading">
          <h2 id="audit-heading" className="text-2xl font-semibold">Every merge has a why</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold">Decision audit log</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                Every merge and every block writes its reason to the decision audit log: which tree was tested, which battery ran, and why a pull request was ejected. When something is questioned, the answer is a lookup, not an investigation — and the log is exportable for your reviewers.
              </p>
            </article>
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold">The scoreboard</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                {scoreboardMetrics.join(" · ")} — read daily, before and after. The scoreboard is the renewal: savings are audited numbers your own queue produced, not a sales claim.
              </p>
            </article>
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">{classifiedCard.kicker}</p>
              <h3 className="mt-3 text-lg font-semibold">{classifiedCard.title}</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">{classifiedCard.body}</p>
            </article>
          </div>
        </section>

        <section className="mt-12 rounded-3xl bg-slate-950 p-7 text-white" aria-labelledby="partner-heading">
          <h2 id="partner-heading" className="text-2xl font-semibold">Become a design partner</h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
            We are onboarding a small number of design-partner teams. Your queue runs on your runners; we bring the control plane, the rules template, and the scoreboard. Write to us and tell us what your merge queue costs you today.
          </p>
          <a href="mailto:hello@solve-lang.com" className="mt-6 inline-block rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white focus-visible:outline focus-visible:outline-2">
            hello@solve-lang.com
          </a>
        </section>
      </div>
    </main>
  );
}
