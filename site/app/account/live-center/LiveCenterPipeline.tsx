"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type LiveCenterBatch,
  type LiveCenterPullRequest,
  type LiveCenterStage,
  groupPullRequestsByStage,
} from "@/app/account/core/live-center";

// The pipeline board: every governed PR sits in exactly one stage
// column, Mergify-style, and the batch planner gets one story card
// underneath. Motion is transform/opacity only, pauses when the board
// is off-screen or the tab is hidden, and is disabled entirely for
// reduced-motion visitors (see the .lc-* rules in globals.css).

const CHIPS_PER_COLUMN = 8;

const STAGE_ACCENTS: Record<LiveCenterStage, { dot: string; chipBorder: string }> = {
  queue: { dot: "bg-slate-400", chipBorder: "border-white/10" },
  checking: { dot: "bg-amber-300", chipBorder: "border-amber-300/20" },
  failing: { dot: "bg-red-400", chipBorder: "border-red-400/25" },
  ready: { dot: "bg-emerald-300", chipBorder: "border-emerald-300/25" },
};

function shortTitle(title: string): string {
  return title.length > 72 ? `${title.slice(0, 69)}…` : title;
}

function PipelineChip({ pr, changed }: { pr: LiveCenterPullRequest; changed: boolean }) {
  const accent = STAGE_ACCENTS[pr.stage];
  return (
    <li
      className={`lc-chip ${changed ? "lc-enter" : ""} rounded-xl border ${accent.chipBorder} bg-slate-950/60 px-3 py-2.5`}
      title={pr.title}
    >
      <p className="truncate text-[13px] font-semibold leading-5 text-white">
        <span className="mr-1.5 text-cyan-300">{pr.number !== null ? `#${pr.number}` : "PR"}</span>
        {shortTitle(pr.title) || "Untitled pull request"}
      </p>
      <p className="mt-1 flex items-center gap-2 text-[11px] font-medium text-slate-400">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${accent.dot} ${pr.stage === "checking" ? "lc-pulse-dot" : ""}`} />
        {pr.total > 0 ? (
          <span>
            {pr.passed}/{pr.total} checks
            {pr.failed > 0 ? <span className="text-red-300"> · {pr.failed} failing</span> : null}
            {pr.pending > 0 ? <span className="text-amber-200"> · {pr.pending} running</span> : null}
          </span>
        ) : (
          <span>No checks reported yet</span>
        )}
        {pr.draft ? <span className="uppercase tracking-[0.12em] text-slate-500">Draft</span> : null}
      </p>
    </li>
  );
}

function BatchStoryCard({ batch }: { batch: LiveCenterBatch }) {
  if (!batch.proposed) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-white/10 bg-slate-950/50 px-5 py-4">
        <p className="text-sm font-semibold text-white">Batch planner</p>
        <p className="text-sm text-slate-300">No batch proposed right now.</p>
        {batch.blockedBy ? (
          <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">
            Blocked by {batch.blockedBy.number !== null ? `#${batch.blockedBy.number}` : "a pull request"}
            {batch.blockedBy.title ? ` — ${shortTitle(batch.blockedBy.title)}` : ""}
          </span>
        ) : null}
        {batch.stoppedReason && batch.stoppedReason !== "unknown" ? (
          <span className="text-xs text-slate-400">Planner note: {batch.stoppedReason}</span>
        ) : null}
        {batch.batchSize > 0 ? (
          <span className="text-xs text-slate-500">Batches of up to {batch.batchSize}</span>
        ) : null}
      </div>
    );
  }

  const steps: { label: string; detail: string }[] = [
    ...batch.members.map((member) => ({
      label: member.number !== null ? `#${member.number}` : "PR",
      detail: shortTitle(member.title) || "Pull request",
    })),
  ];

  return (
    <div className="mt-6 rounded-2xl border border-cyan-300/20 bg-slate-950/50 px-5 py-4">
      <p className="text-sm font-semibold text-white">
        Batch planner proposal
        <span className="ml-2 text-xs font-medium text-slate-400">
          {batch.size} pull request{batch.size === 1 ? "" : "s"}
          {batch.baseRef ? ` onto ${batch.baseRef}` : ""} — checked together as one combined tree
        </span>
      </p>
      <div className="mt-4 flex flex-wrap items-stretch gap-2" aria-label="How the proposed batch is verified">
        {steps.map((step, index) => (
          <div key={`${step.label}-${index}`} className="flex items-center gap-2">
            <div className="lc-step rounded-xl border border-white/10 bg-white/5 px-3 py-2" style={{ animationDelay: `${index * 0.3}s` }}>
              <p className="text-xs font-bold text-cyan-200">{step.label}</p>
              <p className="max-w-[180px] truncate text-[11px] text-slate-300" title={step.detail}>{step.detail}</p>
            </div>
            <span aria-hidden="true" className="text-slate-500">→</span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <div className="lc-step rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2" style={{ animationDelay: `${steps.length * 0.3}s` }}>
            <p className="text-xs font-bold text-cyan-100">Combined check</p>
            <p className="text-[11px] text-slate-300">The batch is tested as one tree</p>
          </div>
          <span aria-hidden="true" className="text-slate-500">→</span>
        </div>
        <div className="lc-step rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-3 py-2" style={{ animationDelay: `${(steps.length + 1) * 0.3}s` }}>
          <p className="text-xs font-bold text-emerald-100">One merge</p>
          <p className="text-[11px] text-slate-300">Lands together if the tree is green</p>
        </div>
      </div>
    </div>
  );
}

export function LiveCenterPipeline({
  pullRequests,
  batch,
  changedNumbers,
}: {
  pullRequests: LiveCenterPullRequest[];
  batch: LiveCenterBatch;
  changedNumbers: ReadonlySet<number>;
}) {
  const groups = useMemo(() => groupPullRequestsByStage(pullRequests), [pullRequests]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setPaused(!entry.isIntersecting);
      },
      { threshold: 0.05 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className={paused ? "lc-paused" : undefined}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {groups.map((group) => (
          <div key={group.stage} className="rounded-2xl bg-slate-900/40 p-3">
            <p className="flex items-center justify-between px-1 text-xs font-bold uppercase tracking-[0.16em] text-slate-300">
              <span className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${STAGE_ACCENTS[group.stage].dot} ${group.stage === "checking" ? "lc-pulse-dot" : ""}`} />
                {group.label}
              </span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">{group.pullRequests.length}</span>
            </p>
            {group.pullRequests.length === 0 ? (
              <p className="px-1 pb-1 pt-3 text-xs text-slate-500">Nothing here right now.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {group.pullRequests.slice(0, CHIPS_PER_COLUMN).map((pr) => (
                  <PipelineChip
                    key={`${group.stage}-${pr.number ?? pr.title}`}
                    pr={pr}
                    changed={pr.number !== null && changedNumbers.has(pr.number)}
                  />
                ))}
              </ul>
            )}
            {group.pullRequests.length > CHIPS_PER_COLUMN ? (
              <p className="px-1 pb-1 pt-2 text-[11px] font-medium text-slate-400">
                +{group.pullRequests.length - CHIPS_PER_COLUMN} more in the pull request list below
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <BatchStoryCard batch={batch} />
    </div>
  );
}
