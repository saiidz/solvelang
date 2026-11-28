import type { Metadata } from "next";
import { BacktestApp } from "../../../verification/backtest/BacktestApp";

export const metadata: Metadata = {
  title: "Backtest your repository's merged PRs — SolveLang Verification",
  description: "Replay SolveLang Verification over a public repository's 10 most recent merged pull requests: what the check would have caught, the false-block candidates, and the unverified share — read-only, no account, nothing posted.",
  alternates: { canonical: "https://www.solve-lang.com/verification/backtest/" },
};

export default function VerificationBacktestPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 text-center lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang Verification — backtest</p>
        <h1 className="mx-auto mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">What would verification have caught in your last ten merges?</h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">The grading replays over your repository&apos;s recent merged pull requests — the same collector, the same receipt, the same PR Gate — and reports the catches, the false-block candidates, and the share of findings the evidence cannot settle. Read-only: it grades history, it does not act on it.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-muted"><span className="rounded-full border border-line bg-panel px-4 py-2">Public repositories</span><span className="rounded-full border border-line bg-panel px-4 py-2">No account, no install</span><span className="rounded-full border border-line bg-panel px-4 py-2">Nothing posted anywhere</span></div>
      </section>
      <BacktestApp />
    </main>
  );
}
