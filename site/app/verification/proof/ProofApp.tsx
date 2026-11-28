import Link from "next/link";
import {
  LIVE_RUNS,
  RECEIPT_AUDITS,
  combinedTotals,
  liveTotals,
  percent,
  receiptTotals,
} from "../demo-data";

const FIXTURE = "saiidz/solvelang-verification-proof";

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-3xl border border-line bg-panel p-6">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="mt-3 text-4xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-sm leading-6 text-body">{detail}</p>
    </div>
  );
}

export function ProofApp() {
  const combined = combinedTotals();
  const live = liveTotals();
  const receipts = receiptTotals();

  return (
    <div className="mx-auto max-w-6xl px-6 pb-20 lg:px-8">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Headline results">
        <StatCard
          label="Real pull requests graded"
          value={String(combined.prs)}
          detail={`${live.prs} graded live by the deployed check, ${receipts.prs} graded through the receipt path and audited by hand.`}
        />
        <StatCard
          label="Unverified share"
          value={percent(combined.unverifiedShare)}
          detail={`${combined.unverified} of ${combined.gradedItems} graded findings were recorded unverified — evidence missing, never guessed. Live runs alone: ${percent(live.unverifiedShare)}.`}
        />
        <StatCard
          label="Defective PRs caught"
          value={`${live.defectiveCaught} of ${live.defectiveTotal}`}
          detail="Every deliberately defective proof PR produced blocking evidence. In enforce mode that evidence concludes the check as a failure."
        />
        <StatCard
          label="False blocks · false “verified” labels"
          value={`${live.cleanFalseBlocks} · ${combined.falseVerifiedLabels}`}
          detail={`None of the ${live.cleanTotal} clean proof PRs was blocked, and no finding anywhere in the set was labeled verified on evidence that did not support it.`}
        />
      </section>

      <section className="mt-12 rounded-3xl border border-line bg-panel p-8 sm:p-10" aria-labelledby="live-runs-heading">
        <h2 id="live-runs-heading" className="text-3xl font-bold">The live runs — the check grading its own proof repository</h2>
        <p className="mt-4 max-w-4xl leading-7 text-body">
          The SolveLang Verification app is installed on the public proof repository{" "}
          <a className="font-semibold text-ink underline" href={`https://github.com/${FIXTURE}`}>{FIXTURE}</a>.
          Each pull request below states its ground truth — defective or clean — in its body, written before the
          check ran. The counts are the check runs&apos; own published summaries; every run also wrote its audit
          record. Durations are the runs&apos; own reported times.
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-2 pr-4 font-semibold">Pull request</th>
                <th className="py-2 pr-4 font-semibold">Ground truth</th>
                <th className="py-2 pr-4 font-semibold">Mode</th>
                <th className="py-2 pr-4 font-semibold">Result</th>
                <th className="py-2 pr-4 font-semibold">Verified</th>
                <th className="py-2 pr-4 font-semibold">Failed</th>
                <th className="py-2 pr-4 font-semibold">Unverified</th>
                <th className="py-2 pr-4 font-semibold">Duration</th>
                <th className="py-2 font-semibold">Check run</th>
              </tr>
            </thead>
            <tbody>
              {LIVE_RUNS.map((run) => (
                <tr key={run.pr} className="border-b border-line align-top last:border-0">
                  <td className="py-3 pr-4 font-semibold">
                    <a className="underline" href={`https://github.com/${FIXTURE}/pull/${run.pr}`}>PR #{run.pr}</a>
                  </td>
                  <td className="py-3 pr-4">{run.groundTruth}</td>
                  <td className="py-3 pr-4">{run.mode}</td>
                  <td className="py-3 pr-4 leading-6 text-body">
                    {run.blockingEvidence
                      ? run.mode === "enforce"
                        ? "Blocked — check concluded failure"
                        : "Blocking evidence found (reported, not enforced)"
                      : "No blocking evidence"}
                  </td>
                  <td className="py-3 pr-4">{run.verified}</td>
                  <td className="py-3 pr-4">{run.failed}</td>
                  <td className="py-3 pr-4">{run.unverified}</td>
                  <td className="py-3 pr-4">{run.durationSeconds.toFixed(1)}s</td>
                  <td className="py-3">{run.checkRunId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted">
          Totals: {live.verified} verified · {live.failed} failed · {live.unverified} unverified across {live.gradedItems} graded
          findings — an unverified share of {percent(live.unverifiedShare)}. Two honest caveats: the runs on PRs #8–#11
          completed with full evidence but their receipt comments could not be posted (a permission the owner granted
          afterwards; from PR #12 on, comments post), and the earliest proof runs (PRs #1–#5) are excluded entirely —
          the methodology page says why.
        </p>
      </section>

      <section className="mt-10 rounded-3xl border border-line bg-panel p-8 sm:p-10" aria-labelledby="receipt-audits-heading">
        <h2 id="receipt-audits-heading" className="text-3xl font-bold">Receipt audits — public PRs on other repositories</h2>
        <p className="mt-4 max-w-4xl leading-7 text-body">
          Before the app existed, the same grading was run through the receipt path over public pull requests on
          well-known repositories, and every result was audited by hand. A <em>catch</em> is a problem the grading
          surfaced from the PR&apos;s own evidence; a <em>tool false positive</em> is a finding the human audit judged
          wrong; <em>unverified</em> counts findings the available evidence could not settle.
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-2 pr-4 font-semibold">Pull request</th>
                <th className="py-2 pr-4 font-semibold">Audited</th>
                <th className="py-2 pr-4 font-semibold">Catches</th>
                <th className="py-2 pr-4 font-semibold">Tool false positives</th>
                <th className="py-2 pr-4 font-semibold">Verified</th>
                <th className="py-2 pr-4 font-semibold">Failed</th>
                <th className="py-2 pr-4 font-semibold">Unverified</th>
                <th className="py-2 font-semibold">False “verified” label</th>
              </tr>
            </thead>
            <tbody>
              {RECEIPT_AUDITS.map((audit) => (
                <tr key={`${audit.repo}#${audit.pr}`} className="border-b border-line align-top last:border-0">
                  <td className="py-3 pr-4 font-semibold">
                    <a className="underline" href={`https://github.com/${audit.repo}/pull/${audit.pr}`}>{audit.repo} #{audit.pr}</a>
                  </td>
                  <td className="py-3 pr-4">{audit.auditedOn}</td>
                  <td className="py-3 pr-4">{audit.catches ?? "—"}</td>
                  <td className="py-3 pr-4">{audit.toolFalsePositives ?? "—"}</td>
                  <td className="py-3 pr-4">{audit.verified ?? "—"}</td>
                  <td className="py-3 pr-4">{audit.failed ?? "—"}</td>
                  <td className="py-3 pr-4">{audit.unverified}</td>
                  <td className="py-3">{audit.falseVerifiedLabel ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted">
          Across the audits: {receipts.catches} catches and {receipts.toolFalsePositives} tool false positives recorded
          on the four catch-counted PRs; {receipts.unverified} of {receipts.gradedItems} graded items unverified
          ({percent(receipts.unverifiedShare)}). The espanso audit recorded graded findings instead of catch counts,
          so it is shown in its own units rather than folded into the catch totals.
        </p>
      </section>

      <section className="mt-10 rounded-3xl border border-line bg-panel p-8 sm:p-10" aria-labelledby="try-heading">
        <h2 id="try-heading" className="text-3xl font-bold">Run it on your own history</h2>
        <p className="mt-4 max-w-4xl leading-7 text-body">
          The backtest replays this grading over a public repository&apos;s recent merged pull requests and reports
          the catches, the false-block candidates, and the unverified share — read-only, nothing posted anywhere.
          Or install the check itself: it is free for public repositories, needs no card, and runs report-only by
          default.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link href="/verification/backtest/" className="inline-flex rounded-xl border border-line-strong px-5 py-3 font-semibold hover:bg-canvas">Run a backtest</Link>
          <a href="https://verify.solve-lang.com/install" className="inline-flex rounded-xl border border-line-strong px-5 py-3 font-semibold hover:bg-canvas">Install the app</a>
          <Link href="/verification/methodology/" className="inline-flex rounded-xl border border-line-strong px-5 py-3 font-semibold hover:bg-canvas">How the grading works</Link>
        </div>
      </section>
    </div>
  );
}
