"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const SERVICE_BASE = "https://verify.solve-lang.com";
const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 120;

interface Classification {
  catch: boolean;
  catchReasons: string[];
  falseBlockCandidate: boolean;
  falseBlockReasons: string[];
  evidenceIncomplete: boolean;
  incompleteReasons: string[];
}

interface BacktestEntry {
  pr: number;
  title: string;
  url: string;
  mergedAt: string;
  graded: boolean;
  error?: string;
  grading?: { verified: number; failed: number; unverified: number };
  classification?: Classification;
}

interface BacktestReport {
  id: string;
  repo: string;
  requestedCount: number;
  generatedAt: string;
  rateLimited: boolean;
  entries: BacktestEntry[];
  summary: {
    prsRequested: number;
    prsGraded: number;
    prsErrored: number;
    catches: number;
    falseBlockCandidates: number;
    evidenceIncomplete: number;
    findings: { verified: number; failed: number; unverified: number };
    unverifiedShare: number;
  };
}

interface JobState {
  id: string;
  status: string;
  error: string | null;
  report: BacktestReport | null;
}

type Phase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "running"; id: string; startedAt: number }
  | { kind: "complete"; report: BacktestReport; cached: boolean }
  | { kind: "error"; message: string };

function parseRepoInput(raw: string): { owner: string; repo: string } | null {
  const cleaned = raw
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const parts = cleaned.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function errorMessage(code: string | null): string {
  switch (code) {
    case "repository_not_public_or_not_found":
      return "That repository was not found, or it is not public. The backtest reads public repositories only.";
    case "rate_limited":
      return "Too many backtests were started from this connection in the last hour. The upstream GitHub budget is shared — try again later.";
    case "invalid_repository":
      return "That does not look like a GitHub repository. Use the form owner/repository.";
    default:
      return "The backtest could not be completed. Nothing was posted or changed anywhere.";
  }
}

export function BacktestApp() {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  async function poll(id: string, attempts: number) {
    try {
      const response = await fetch(`${SERVICE_BASE}/backtest/${id}`);
      if (!response.ok) throw new Error("poll_failed");
      const job = (await response.json()) as JobState;
      if (job.status === "complete" && job.report) {
        setPhase({ kind: "complete", report: job.report, cached: false });
        return;
      }
      if (job.status === "error") {
        setPhase({ kind: "error", message: errorMessage(job.error) });
        return;
      }
    } catch {
      // A failed poll is not a failed job; keep polling within the cap.
    }
    if (attempts >= MAX_POLLS) {
      setPhase({
        kind: "error",
        message:
          "The backtest is taking longer than this page waits. Large repositories grade slowly — the report is cached per repository for 24 hours once it completes, so starting it again later will return it instantly.",
      });
      return;
    }
    pollTimer.current = setTimeout(() => void poll(id, attempts + 1), POLL_INTERVAL_MS);
  }

  async function start(raw: string) {
    const parsed = parseRepoInput(raw);
    if (!parsed) {
      setPhase({ kind: "error", message: errorMessage("invalid_repository") });
      return;
    }
    setPhase({ kind: "submitting" });
    try {
      const response = await fetch(`${SERVICE_BASE}/backtest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: parsed.owner, repo: parsed.repo, count: 10 }),
      });
      if (response.status === 429) {
        setPhase({ kind: "error", message: errorMessage("rate_limited") });
        return;
      }
      if (!response.ok) {
        setPhase({ kind: "error", message: errorMessage("invalid_repository") });
        return;
      }
      const started = (await response.json()) as {
        id: string;
        status: string;
        cached: boolean;
        report?: BacktestReport;
      };
      if (started.cached && started.report) {
        setPhase({ kind: "complete", report: started.report, cached: true });
        return;
      }
      setPhase({ kind: "running", id: started.id, startedAt: Date.now() });
      pollTimer.current = setTimeout(() => void poll(started.id, 0), POLL_INTERVAL_MS);
    } catch {
      setPhase({
        kind: "error",
        message: "The backtest service could not be reached. Nothing was posted or changed anywhere.",
      });
    }
  }

  const busy = phase.kind === "submitting" || phase.kind === "running";

  return (
    <div className="mx-auto max-w-6xl px-6 pb-20 lg:px-8">
      <section className="rounded-3xl border border-line bg-panel p-8 sm:p-10" aria-labelledby="backtest-form-heading">
        <h2 id="backtest-form-heading" className="text-3xl font-bold">Replay a public repository</h2>
        <p className="mt-4 max-w-4xl leading-7 text-body">
          Enter a public GitHub repository. The backtest grades its 10 most recent merged pull requests with the
          same machinery the live check uses, and reports the catches, the false-block candidates, and the
          unverified share. Read-only throughout: nothing is posted, commented, or changed, and no account is
          needed. Completed reports are cached per repository for 24 hours.
        </p>
        <form
          className="mt-8 flex flex-wrap items-center gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void start(input);
          }}
        >
          <label className="sr-only" htmlFor="backtest-repo">GitHub repository, as owner/repository</label>
          <input
            id="backtest-repo"
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="owner/repository"
            autoComplete="off"
            spellCheck={false}
            className="min-w-72 flex-1 rounded-xl border border-line-strong bg-canvas px-4 py-3 font-mono text-sm text-ink placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex rounded-xl border border-line-strong px-5 py-3 font-semibold hover:bg-canvas disabled:opacity-50"
          >
            {busy ? "Grading…" : "Run the backtest"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setInput("saiidz/solvelang-verification-proof");
              void start("saiidz/solvelang-verification-proof");
            }}
            className="inline-flex rounded-xl border border-line px-5 py-3 font-semibold text-body hover:bg-canvas disabled:opacity-50"
          >
            Try the proof repository
          </button>
        </form>
        {phase.kind === "running" ? (
          <p className="mt-6 text-sm leading-6 text-muted" role="status">
            Grading the merged pull requests — each one is collected, gate-checked, and graded. This usually takes
            under a minute for a small repository and a few minutes for a large one. Keep this page open.
          </p>
        ) : null}
        {phase.kind === "error" ? (
          <p className="mt-6 text-sm leading-6 text-body" role="alert">{phase.message}</p>
        ) : null}
      </section>

      {phase.kind === "complete" ? (
        <section className="mt-10" aria-labelledby="backtest-report-heading">
          <div className="rounded-3xl border border-line bg-panel p-8 sm:p-10">
            <h2 id="backtest-report-heading" className="text-3xl font-bold">
              Backtest — {phase.report.repo}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Generated {new Date(phase.report.generatedAt).toLocaleString()}
              {phase.cached ? " · served from the 24-hour per-repository cache" : ""}
              {phase.report.rateLimited
                ? " · GitHub rate-limited this run partway; ungraded pull requests are marked below, not hidden."
                : ""}
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-3xl border border-line bg-canvas p-6">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">PRs graded</p>
                <p className="mt-3 text-4xl font-semibold tracking-tight">
                  {phase.report.summary.prsGraded} of {phase.report.summary.prsRequested}
                </p>
              </div>
              <div className="rounded-3xl border border-line bg-canvas p-6">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">Catches</p>
                <p className="mt-3 text-4xl font-semibold tracking-tight">{phase.report.summary.catches}</p>
              </div>
              <div className="rounded-3xl border border-line bg-canvas p-6">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">False-block candidates</p>
                <p className="mt-3 text-4xl font-semibold tracking-tight">{phase.report.summary.falseBlockCandidates}</p>
              </div>
              <div className="rounded-3xl border border-line bg-canvas p-6">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">Unverified share</p>
                <p className="mt-3 text-4xl font-semibold tracking-tight">{percent(phase.report.summary.unverifiedShare)}</p>
                <p className="mt-2 text-sm leading-6 text-body">
                  {phase.report.summary.findings.unverified} of{" "}
                  {phase.report.summary.findings.verified +
                    phase.report.summary.findings.failed +
                    phase.report.summary.findings.unverified}{" "}
                  graded findings
                </p>
              </div>
            </div>
            <div className="mt-8 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th className="py-2 pr-4 font-semibold">Pull request</th>
                    <th className="py-2 pr-4 font-semibold">Merged</th>
                    <th className="py-2 pr-4 font-semibold">Verified</th>
                    <th className="py-2 pr-4 font-semibold">Failed</th>
                    <th className="py-2 pr-4 font-semibold">Unverified</th>
                    <th className="py-2 font-semibold">Classification</th>
                  </tr>
                </thead>
                <tbody>
                  {phase.report.entries.map((entry) => (
                    <tr key={entry.pr} className="border-b border-line align-top last:border-0">
                      <td className="py-3 pr-4 font-semibold">
                        <a className="underline" href={entry.url}>#{entry.pr}</a>{" "}
                        <span className="font-normal text-body">{entry.title}</span>
                      </td>
                      <td className="py-3 pr-4">{new Date(entry.mergedAt).toLocaleDateString()}</td>
                      {entry.graded && entry.grading ? (
                        <>
                          <td className="py-3 pr-4">{entry.grading.verified}</td>
                          <td className="py-3 pr-4">{entry.grading.failed}</td>
                          <td className="py-3 pr-4">{entry.grading.unverified}</td>
                          <td className="py-3 leading-6">
                            {entry.classification?.catch ? (
                              <span className="font-semibold">Catch</span>
                            ) : entry.classification?.falseBlockCandidate ? (
                              <span className="font-semibold">False-block candidate</span>
                            ) : (
                              <span>No catch</span>
                            )}
                            {entry.classification?.evidenceIncomplete ? (
                              <span className="text-body"> · evidence incomplete</span>
                            ) : null}
                            {entry.classification &&
                            (entry.classification.catchReasons.length > 0 ||
                              entry.classification.falseBlockReasons.length > 0 ||
                              entry.classification.incompleteReasons.length > 0) ? (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-muted">Why</summary>
                                <ul className="mt-1 list-disc space-y-1 pl-5 text-body">
                                  {entry.classification.catchReasons.map((reason) => (
                                    <li key={reason}>{reason}</li>
                                  ))}
                                  {entry.classification.falseBlockReasons.map((reason) => (
                                    <li key={reason}>{reason}</li>
                                  ))}
                                  {entry.classification.incompleteReasons.map((reason) => (
                                    <li key={reason}>{reason}</li>
                                  ))}
                                </ul>
                              </details>
                            ) : null}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-3 pr-4">—</td>
                          <td className="py-3 pr-4">—</td>
                          <td className="py-3 pr-4">—</td>
                          <td className="py-3 leading-6 text-body">Not graded — {entry.error ?? "unknown reason"}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-6 text-sm leading-6 text-muted">
              Definitions — <strong className="text-ink">catch</strong>: blocking evidence existed on the PR&apos;s
              head under the product&apos;s blocking rules. <strong className="text-ink">False-block candidate</strong>:
              a failing run superseded by a successful re-run of the same check on the same head, completed before
              the merge. <strong className="text-ink">Evidence incomplete</strong>: the PR Gate route failed or did
              not run — never counted as a catch. The full methodology is on the{" "}
              <Link className="font-semibold text-ink underline" href="/verification/methodology/">methodology page</Link>,
              and the check&apos;s own public proof is on the{" "}
              <Link className="font-semibold text-ink underline" href="/verification/proof/">proof page</Link>.
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
