"use client";

// Shared building blocks for the Live Center views: the pull-request
// row (with its expandable check detail), the segmented check bar,
// status icons, the GitHub-style pager, and the blankslate panel.
// Every status is icon + words, never colour alone, and every
// control says in plain language what it opens or does.

import { useState, type ReactNode } from "react";
import {
  type LiveCenterCheckRun,
  type LiveCenterPullRequest,
  type LiveCenterStage,
  formatDurationMs,
  formatRelativeTime,
  gateStateLabel,
  reviewStateLabel,
  shortSha,
} from "@/app/account/core/live-center";

export const LC_PANEL = "rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5";
export const LC_BTN =
  "inline-block rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-white/10";
export const LC_BTN_SMALL =
  "inline-block rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10";

export function githubPrUrl(repoLabel: string, number: number | null): string {
  return number !== null && repoLabel
    ? `https://github.com/${repoLabel}/pull/${number}`
    : "https://github.com";
}

export function githubRunUrl(repoLabel: string, runId: number | null): string {
  return runId !== null && repoLabel
    ? `https://github.com/${repoLabel}/actions/runs/${runId}`
    : "https://github.com";
}

export function githubRepoUrl(repoLabel: string): string {
  return repoLabel ? `https://github.com/${repoLabel}` : "https://github.com";
}

const STAGE_GLYPH: Record<LiveCenterStage, { glyph: string; className: string; label: string }> = {
  ready: { glyph: "✓", className: "text-emerald-400", label: "Ready" },
  failing: { glyph: "✕", className: "text-rose-400", label: "Failing" },
  checking: { glyph: "◐", className: "lc-spin text-amber-300", label: "Checking" },
  queue: { glyph: "◌", className: "text-slate-400", label: "In queue" },
};

export function StageIcon({ stage, className = "" }: { stage: LiveCenterStage; className?: string }) {
  const entry = STAGE_GLYPH[stage];
  return (
    <span aria-hidden="true" className={`inline-block shrink-0 text-base leading-none ${entry.className} ${className}`}>
      {entry.glyph}
    </span>
  );
}

export function stageWord(stage: LiveCenterStage): string {
  return STAGE_GLYPH[stage].label;
}

export function CheckIcon({ run }: { run: LiveCenterCheckRun }) {
  if (run.status === "completed") {
    if (run.conclusion === "success") return <span aria-hidden="true" className="inline-block shrink-0 text-emerald-400">✓</span>;
    if (["failure", "timed_out", "action_required", "startup_failure"].includes(run.conclusion)) {
      return <span aria-hidden="true" className="inline-block shrink-0 text-rose-400">✕</span>;
    }
    return <span aria-hidden="true" className="inline-block shrink-0 text-slate-500">–</span>;
  }
  if (run.status === "in_progress") {
    return <span aria-hidden="true" className="lc-spin inline-block shrink-0 text-amber-300">◐</span>;
  }
  return <span aria-hidden="true" className="inline-block shrink-0 text-slate-500">○</span>;
}

export function checkStateWord(run: LiveCenterCheckRun): string {
  if (run.status === "completed") {
    if (run.conclusion === "success") return "Passed";
    if (run.conclusion === "failure") return "Failed";
    if (run.conclusion === "timed_out") return "Timed out";
    if (run.conclusion === "cancelled") return "Cancelled";
    if (run.conclusion === "skipped") return "Skipped";
    if (run.conclusion === "neutral") return "Neutral";
    if (run.conclusion === "action_required") return "Needs action";
    if (run.conclusion === "startup_failure") return "Failed to start";
    return "Finished";
  }
  if (run.status === "in_progress") return "Running";
  if (run.status === "queued" || run.status === "pending") return "Queued";
  if (run.status === "waiting") return "Waiting";
  return run.status || "Unknown";
}

// The segmented bar: one segment per check outcome, widths in
// proportion. Always paired with the counts in text next to it.
export function SegBar({ passed, failed, pending }: { passed: number; failed: number; pending: number }) {
  const total = passed + failed + pending;
  if (total === 0) return null;
  const pct = (value: number) => `${Math.max(0, (value / total) * 100).toFixed(1)}%`;
  return (
    <span
      aria-hidden="true"
      className="flex h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-white/10"
    >
      {passed > 0 ? <span className="bg-emerald-400" style={{ width: pct(passed) }} /> : null}
      {failed > 0 ? <span className="bg-rose-400" style={{ width: pct(failed) }} /> : null}
      {pending > 0 ? <span className="bg-amber-300" style={{ width: pct(pending) }} /> : null}
    </span>
  );
}

function RollupIcon({ pr }: { pr: LiveCenterPullRequest }) {
  if (pr.failed > 0) return <span aria-hidden="true" className="text-rose-400">✕</span>;
  if (pr.pending > 0) return <span aria-hidden="true" className="lc-spin inline-block text-amber-300">◐</span>;
  if (pr.total > 0) return <span aria-hidden="true" className="text-emerald-400">✓</span>;
  return <span aria-hidden="true" className="text-slate-500">◌</span>;
}

function Chip({ className, children, title }: { className: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight ${className}`}
    >
      {children}
    </span>
  );
}

function CheckDetail({ pr }: { pr: LiveCenterPullRequest }) {
  const [showPassed, setShowPassed] = useState(false);
  const runs = pr.checkRuns;
  if (runs.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-slate-400">
        <p>
          This board read carries the check counts but not the individual check names for this
          pull request yet. The counts above are exact; the named list appears on reads served by
          the current Live Center data.
        </p>
        {pr.failing.length > 0 ? (
          <p className="mt-2 text-rose-300">Failing: {pr.failing.join(", ")}</p>
        ) : null}
      </div>
    );
  }
  const failing = runs.filter(
    (run) => run.status === "completed" && ["failure", "timed_out", "action_required", "startup_failure"].includes(run.conclusion),
  );
  const active = runs.filter((run) => run.status !== "completed");
  const passed = runs.filter((run) => run.status === "completed" && run.conclusion === "success");
  const other = runs.filter(
    (run) => run.status === "completed" && run.conclusion !== "success" && !failing.includes(run),
  );
  const row = (run: LiveCenterCheckRun) => (
    <li key={`${run.kind}-${run.name}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1">
      <CheckIcon run={run} />
      <span className="min-w-0 break-words font-medium text-slate-200">{run.name}</span>
      {run.required === true ? (
        <Chip className="border-sky-300/30 bg-sky-400/10 text-sky-200" title="This check must pass before the pull request can merge.">
          Required
        </Chip>
      ) : null}
      <span className="text-xs text-slate-400">
        {checkStateWord(run)}
        {run.durationMs !== null ? ` · took ${formatDurationMs(run.durationMs)}` : ""}
      </span>
    </li>
  );
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-xs text-slate-400">
        {runs.length} checks on the newest commit · {passed.length} passed · {failing.length} failed
        · {active.length} still running or queued · {gateStateLabel(pr.gate.state).toLowerCase()}
        {pr.gate.checks.length > 0 ? ` (${pr.gate.checks.join(", ")})` : ""}
      </p>
      <ul className="mt-1 divide-y divide-white/5">
        {failing.map(row)}
        {active.map(row)}
        {other.map(row)}
      </ul>
      {passed.length > 0 ? (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setShowPassed((value) => !value)}
            aria-expanded={showPassed}
            className="text-sm text-emerald-300 underline-offset-2 hover:underline"
          >
            {showPassed ? "▾" : "▸"} ✓ {passed.length} checks passed{showPassed ? " — hide them" : " — show them"}
          </button>
          {showPassed ? <ul className="divide-y divide-white/5">{passed.map(row)}</ul> : null}
        </div>
      ) : null}
    </div>
  );
}

export function PrRow({
  pr,
  repoLabel,
  showPosition = false,
}: {
  pr: LiveCenterPullRequest;
  repoLabel: string;
  showPosition?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const url = githubPrUrl(repoLabel, pr.number);
  const opened = pr.createdAt ? formatRelativeTime(pr.createdAt) : "";
  const detailLabel = `Checks — ${pr.passed} passed${pr.failed > 0 ? ` · ${pr.failed} failing` : ""}${pr.pending > 0 ? ` · ${pr.pending} running or queued` : ""}`;
  return (
    <div className={`py-3 ${pr.draft ? "opacity-75" : ""}`}>
      <div className="flex items-start gap-3">
        {showPosition && pr.position > 0 ? (
          <span className="w-7 shrink-0 pt-0.5 text-right text-sm font-semibold text-slate-500">
            {pr.position}
          </span>
        ) : null}
        <span className="pt-0.5">
          <StageIcon stage={pr.stage} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 break-words font-semibold text-slate-100 underline-offset-2 hover:underline"
            >
              {pr.title || "Untitled pull request"}
            </a>
            {pr.draft ? (
              <Chip className="border-violet-300/30 bg-violet-400/10 text-violet-200" title="A draft cannot merge. Only its author can mark it ready for review.">
                Draft
              </Chip>
            ) : null}
            {pr.isStackChild ? (
              <Chip className="border-sky-300/30 bg-sky-400/10 text-sky-200" title="This pull request builds on another pull request instead of the main branch. It joins the queue properly once its parent lands.">
                Stack child
              </Chip>
            ) : null}
            {pr.needsOwner ? (
              <Chip className="border-amber-300/30 bg-amber-400/10 text-amber-200" title="Something on this pull request is waiting on a person. The Inbox tab lists exactly what.">
                Waiting on you
              </Chip>
            ) : null}
            {pr.mergeableState === "dirty" ? (
              <Chip className="border-rose-300/30 bg-rose-400/10 text-rose-200" title="The branch and the base branch changed the same lines. The author has to resolve the conflict.">
                Conflicts
              </Chip>
            ) : null}
            {pr.labels.map((label) => (
              <Chip key={label} className="border-white/15 bg-white/5 text-slate-300">
                {label}
              </Chip>
            ))}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
            <a href={url} target="_blank" rel="noreferrer" className="font-medium text-slate-300 hover:underline">
              #{pr.number ?? "—"}
            </a>
            {pr.author ? (
              <span>
                {pr.author}
                {opened ? ` opened ${opened}` : ""}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <RollupIcon pr={pr} /> {pr.passed}/{pr.total} checks
            </span>
            {pr.headSha ? (
              <span className="font-mono text-[11px] text-slate-500">{shortSha(pr.headSha)}</span>
            ) : null}
            {pr.headRef || pr.baseRef ? (
              <span className="font-mono text-[11px] text-slate-500">
                {pr.headRef || "?"} → {pr.baseRef || "?"}
              </span>
            ) : null}
            {pr.comments > 0 ? <span>💬 {pr.comments}</span> : null}
            <span className="text-slate-500">{stageWord(pr.stage)}</span>
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="w-28 shrink-0 sm:w-36">
              <SegBar passed={pr.passed} failed={pr.failed} pending={pr.pending} />
            </span>
            {pr.review.state !== "none" ? (
              <span className="text-xs text-slate-400">
                {pr.review.state === "approved"
                  ? `✓ ${reviewStateLabel(pr.review.state)}${pr.review.approvals.length > 0 ? ` by ${pr.review.approvals.join(", ")}` : ""}`
                  : pr.review.state === "changes_requested"
                    ? `✕ ${reviewStateLabel(pr.review.state)}${pr.review.changesRequestedBy.length > 0 ? ` by ${pr.review.changesRequestedBy.join(", ")}` : ""}`
                    : `◐ ${reviewStateLabel(pr.review.state)}${pr.review.requestedReviewers.length > 0 ? ` — waiting on ${pr.review.requestedReviewers.join(", ")}` : ""}`}
              </span>
            ) : null}
            {pr.gate.state !== "unknown" ? (
              <span className="text-xs text-slate-400">
                {pr.gate.state === "passed" ? "✓ " : pr.gate.state === "failing" ? "✕ " : "◐ "}
                {gateStateLabel(pr.gate.state)}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="mt-1.5 text-sm text-slate-300 underline-offset-2 hover:underline"
          >
            {expanded ? "▾" : "▸"} {detailLabel}
          </button>
          {expanded ? <CheckDetail pr={pr} /> : null}
        </div>
      </div>
    </div>
  );
}

// GitHub-style numbered pager: previous/next plus a window of page
// numbers, with the total spelled out. Used by every long list.
export function LcPager({
  page,
  pages,
  total,
  noun,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) {
    return total > 0 ? (
      <p className="mt-3 text-xs text-slate-500">
        {total} {noun}
      </p>
    ) : null;
  }
  const windowPages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  for (let p = start; p <= Math.min(pages, start + 4); p += 1) windowPages.push(p);
  const btn =
    "inline-block min-w-8 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center text-sm text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center gap-1.5">
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        ‹ Prev
      </button>
      {windowPages[0] > 1 ? (
        <>
          <button type="button" className={btn} onClick={() => onPage(1)}>1</button>
          <span className="px-1 text-slate-500">…</span>
        </>
      ) : null}
      {windowPages.map((p) => (
        <button
          key={p}
          type="button"
          aria-current={p === page ? "page" : undefined}
          className={p === page ? `${btn} border-sky-300/40 bg-sky-400/15 text-sky-100` : btn}
          onClick={() => onPage(p)}
        >
          {p}
        </button>
      ))}
      {windowPages[windowPages.length - 1] < pages ? (
        <>
          <span className="px-1 text-slate-500">…</span>
          <button type="button" className={btn} onClick={() => onPage(pages)}>{pages}</button>
        </>
      ) : null}
      <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        Next ›
      </button>
      <span className="ml-2 text-xs text-slate-500">
        Page {page} of {pages} · {total} {noun}
      </span>
    </nav>
  );
}

export function LcEmpty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4 text-center sm:p-6">
      <p className="font-semibold text-slate-200">{title}</p>
      <div className="mx-auto mt-1 max-w-xl text-sm text-slate-400">{children}</div>
    </div>
  );
}
