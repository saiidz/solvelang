"use client";

// The Checks/Runs tab and the Runners tab.
//
// Runs shows the repository's recent workflow runs — the checks in
// motion. Runners shows what the run data itself proves: a job in
// progress WITH a runner name is a busy runner; a queued job is
// waiting for one. The full fleet list (every machine, idle or not)
// needs one more GitHub permission than the app holds today, so that
// panel sits behind its permission seam with an honest label —
// nothing about the fleet is guessed.

import { useMemo, useState } from "react";
import {
  type LiveCenterBoardView,
  type LiveCenterRun,
  formatRelativeTime,
  shortSha,
} from "@/app/account/core/live-center";
import {
  LC_PANEL,
  LcEmpty,
  githubPrUrl,
  githubRunUrl,
} from "@/app/account/live-center/LiveCenterPrRows";

type RunFilter = "all" | "queued" | "running" | "passed" | "failed";

function runCategory(run: LiveCenterRun): RunFilter | "other" {
  if (run.rawStatus === "queued" || run.rawStatus === "requested" || run.rawStatus === "waiting" || run.rawStatus === "pending") {
    return "queued";
  }
  if (run.rawStatus === "in_progress") return "running";
  if (run.rawStatus === "completed") {
    if (run.conclusion === "success") return "passed";
    if (["failure", "timed_out", "action_required", "startup_failure"].includes(run.conclusion)) return "failed";
  }
  return "other";
}

function RunIcon({ run }: { run: LiveCenterRun }) {
  const category = runCategory(run);
  if (category === "passed") return <span aria-hidden="true" className="text-emerald-400">✓</span>;
  if (category === "failed") return <span aria-hidden="true" className="text-rose-400">✕</span>;
  if (category === "running") return <span aria-hidden="true" className="lc-spin inline-block text-amber-300">◐</span>;
  if (category === "queued") return <span aria-hidden="true" className="text-slate-400">○</span>;
  return <span aria-hidden="true" className="text-slate-500">–</span>;
}

export function LiveCenterRuns({ board }: { board: LiveCenterBoardView }) {
  const [filter, setFilter] = useState<RunFilter>("all");
  const titleByNumber = useMemo(() => {
    const map = new Map<number, { title: string; author: string }>();
    for (const pr of board.pullRequests) {
      if (pr.number !== null) map.set(pr.number, { title: pr.title, author: pr.author });
    }
    return map;
  }, [board.pullRequests]);
  const counts = useMemo(() => {
    const result: Record<RunFilter, number> = { all: board.runs.length, queued: 0, running: 0, passed: 0, failed: 0 };
    for (const run of board.runs) {
      const category = runCategory(run);
      if (category !== "other") result[category] += 1;
    }
    return result;
  }, [board.runs]);
  const visible = filter === "all" ? board.runs : board.runs.filter((run) => runCategory(run) === filter);

  const chip = (id: RunFilter, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      aria-pressed={filter === id}
      className={`inline-block rounded-full border px-3 py-1 text-sm transition ${
        filter === id
          ? "border-sky-300/40 bg-sky-400/15 font-semibold text-sky-100"
          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
      }`}
    >
      {label} <span className="text-xs text-slate-400">{counts[id]}</span>
    </button>
  );

  return (
    <section aria-label="Checks and workflow runs" className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-400">
        Every workflow run GitHub reports for this repository — the checks in motion. A run is one
        workflow firing on one commit; its jobs are the individual pieces of work, and the Runners
        tab shows which machines they landed on.
      </p>
      <div className={LC_PANEL}>
        <div className="flex flex-wrap gap-2">
          {chip("all", "All")}
          {chip("queued", "Queued")}
          {chip("running", "Running")}
          {chip("passed", "Passed")}
          {chip("failed", "Failed")}
        </div>
        {visible.length === 0 ? (
          <div className="mt-4">
            <LcEmpty title="No runs to show">
              <p>
                {board.runs.length === 0
                  ? "GitHub reports no recent workflow runs for this repository. Runs appear here as soon as a workflow starts — opening or pushing to a pull request is what usually starts one."
                  : "No runs match this filter right now. Pick another filter above to see the rest."}
              </p>
            </LcEmpty>
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-white/5">
            {visible.map((run) => {
              const prNumber = run.pullRequestNumbers[0] ?? null;
              const linked = prNumber !== null ? titleByNumber.get(prNumber) : undefined;
              const title = linked?.title || run.workflowName;
              return (
                <li key={run.runId ?? `${run.workflowName}-${run.updatedAt}`} className="flex items-start gap-3 py-3">
                  <span className="pt-0.5">
                    <RunIcon run={run} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={githubRunUrl(board.repoLabel, run.runId)}
                      target="_blank"
                      rel="noreferrer"
                      className="break-words font-semibold text-slate-100 underline-offset-2 hover:underline"
                    >
                      {title}
                    </a>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-400">
                      <span>
                        {run.workflowName}
                        {run.runId !== null ? ` #${run.runId}` : ""}
                      </span>
                      {prNumber !== null ? (
                        <span>
                          ·{" "}
                          <a href={githubPrUrl(board.repoLabel, prNumber)} target="_blank" rel="noreferrer" className="hover:underline">
                            Pull request #{prNumber}
                          </a>
                          {linked?.author ? ` opened by ${linked.author}` : ""}
                        </span>
                      ) : null}
                      <span>
                        · {run.jobs.length} job{run.jobs.length === 1 ? "" : "s"}
                      </span>
                      {run.headSha ? (
                        <span className="font-mono text-[11px] text-slate-500">{shortSha(run.headSha)}</span>
                      ) : null}
                      {run.headBranch ? (
                        <span className="font-mono text-[11px] text-slate-500">{run.headBranch}</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-slate-400">{formatRelativeTime(run.updatedAt)}</p>
                    <p className="text-xs font-medium text-slate-300">{run.status}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export function LiveCenterRunners({ board }: { board: LiveCenterBoardView }) {
  const { runners } = board;
  const runningJobs = useMemo(() => {
    const rows: { name: string; workflowName: string; runnerName: string }[] = [];
    for (const run of board.runs) {
      for (const job of run.jobs) {
        if (job.rawStatus === "in_progress") {
          rows.push({ name: job.name, workflowName: run.workflowName, runnerName: job.runnerName });
        }
      }
    }
    return rows;
  }, [board.runs]);

  return (
    <section aria-label="Runners" className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-400">
        <strong className="text-slate-200">
          {runners.busyCount} busy · {runners.waitingCount} jobs waiting
        </strong>{" "}
        — this is what GitHub reports on the current jobs themselves: a job in progress names the
        runner doing it, and a queued job is waiting for a runner to pick it up.
      </p>

      <div className={LC_PANEL}>
        <h3 className="font-semibold text-slate-100">Working now</h3>
        {runners.busy.length === 0 && runningJobs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">
            No job is running at this moment, so no runner is reporting as busy. When a check
            starts, the runner doing the work appears here with the job it is on.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-white/5">
            {runners.busy.map((entry) => (
              <li key={`${entry.name}-${entry.jobName}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                <span className="font-mono text-sm font-semibold text-slate-100">{entry.name}</span>
                <span className="text-sm text-slate-400">
                  working now — {entry.jobName} ({entry.workflowName})
                </span>
              </li>
            ))}
          </ul>
        )}

        {runningJobs.length > 0 ? (
          <>
            <h3 className="mt-5 font-semibold text-slate-100">Jobs running</h3>
            <ul className="mt-2 divide-y divide-white/5">
              {runningJobs.map((job, index) => (
                <li key={`${job.name}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span aria-hidden="true" className="lc-spin inline-block text-amber-300">◐</span>
                  <span className="min-w-0 break-words text-sm font-medium text-slate-200">{job.name}</span>
                  <span className="inline-block rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">
                    Running{job.runnerName ? ` · ${job.runnerName}` : " · runner not reported yet"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <h3 className="mt-5 font-semibold text-slate-100">Waiting for a runner</h3>
        {runners.queuedJobs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">
            Nothing is queued. Every job GitHub knows about has either started or finished.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-white/5">
            {runners.queuedJobs.map((job, index) => (
              <li key={`${job.name}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span aria-hidden="true" className="text-slate-400">○</span>
                <span className="min-w-0 break-words text-sm font-medium text-slate-200">{job.name}</span>
                <span className="inline-block rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">
                  Queued — waiting for a runner
                </span>
                <span className="text-xs text-slate-500">{job.workflowName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-4 sm:p-5">
        <h3 className="font-semibold text-slate-100">Your full runner fleet</h3>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Seeing every machine in your fleet — including the ones sitting idle right now — needs
          one more GitHub permission: <strong className="text-slate-200">Repository Administration, read-only</strong>.
          Until it is granted, this page can only show the runners GitHub reports on current jobs,
          which is everything above. No runner is being hidden from you by SolveLang; GitHub
          simply does not report idle machines without that permission.
        </p>
      </div>
    </section>
  );
}
