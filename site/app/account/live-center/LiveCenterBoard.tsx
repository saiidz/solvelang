"use client";

// The Live Center board: one signed-in page with eight tabs —
// Overview, Pull requests, Queue, Checks, Runners, Statistics,
// Inbox, and Minutes — fed by the Merge Governance pilot through
// the session-gated api-access proxy. The session is proven first
// (GET /customer/account); the board is never requested without it,
// and there is no guest view.
//
// Header controls, in plain words: Pause stops the automatic
// refresh while you read; Freeze pins the page to the snapshot on
// screen so the numbers cannot move while you compare them;
// Refresh fetches the newest board right now. All three act on
// this page only — the queue itself is governed by the
// repository's own merge rules.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CustomerApiError,
  type CustomerDashboard,
  customerApi,
  normalizeApiBase,
} from "@/app/account/core/customer-api";
import {
  type LiveCenterBoardView,
  type LiveCenterMinutesView,
  type LiveCenterBoardFilter,
  filterLiveCenterPullRequests,
  formatRelativeTime,
  normalizeLiveCenterBoard,
  normalizeLiveCenterMinutes,
  paginateList,
} from "@/app/account/core/live-center";
import {
  LC_BTN,
  LC_PANEL,
  LcPager,
  PrRow,
  githubRepoUrl,
} from "@/app/account/live-center/LiveCenterPrRows";
import { LiveCenterQueue } from "@/app/account/live-center/LiveCenterQueue";
import { LiveCenterRuns, LiveCenterRunners } from "@/app/account/live-center/LiveCenterRuns";
import { LiveCenterStats } from "@/app/account/live-center/LiveCenterStats";
import { LiveCenterInbox } from "@/app/account/live-center/LiveCenterInbox";
import { LiveCenterMinutes } from "@/app/account/live-center/LiveCenterMinutes";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const REFRESH_MS = 60_000;

type Phase = "loading" | "ready" | "not-configured" | "signed-out" | "error";
type TabId = "overview" | "prs" | "queue" | "runs" | "runners" | "stats" | "inbox" | "minutes";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "prs", label: "Pull requests" },
  { id: "queue", label: "Queue" },
  { id: "runs", label: "Checks" },
  { id: "runners", label: "Runners" },
  { id: "stats", label: "Statistics" },
  { id: "inbox", label: "Inbox" },
  { id: "minutes", label: "Minutes" },
];

const PR_FILTERS: { id: LiveCenterBoardFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "failing", label: "Failing" },
  { id: "checking", label: "Checking" },
  { id: "ready", label: "Ready" },
  { id: "drafts", label: "Drafts" },
  { id: "waiting", label: "Waiting on me" },
];

function runGlyph(status: string): { glyph: string; className: string } {
  if (status === "Passed") return { glyph: "✓", className: "text-emerald-400" };
  if (status === "Failed") return { glyph: "✕", className: "text-rose-400" };
  if (status === "Running") return { glyph: "◐", className: "lc-spin text-amber-300" };
  if (status === "Queued" || status === "Waiting") return { glyph: "○", className: "text-slate-400" };
  return { glyph: "–", className: "text-slate-500" };
}

function Overview({
  board,
  onShowFailing,
  onOpenQueue,
  onOpenInbox,
}: {
  board: LiveCenterBoardView;
  onShowFailing: () => void;
  onOpenQueue: () => void;
  onOpenInbox: () => void;
}) {
  const stats = board.stats;
  const head = board.pullRequests[0] ?? null;
  const conflicts = board.pullRequests.filter((pr) => pr.mergeableState === "dirty").length;
  const totalChecks = board.pullRequests.reduce((sum, pr) => sum + pr.total, 0);
  const passedChecks = board.pullRequests.reduce((sum, pr) => sum + pr.passed, 0);
  const passedPct = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : null;

  const attention: { key: string; title: string; text: string; action: string; go: () => void }[] = [];
  if (head) {
    attention.push({
      key: "head",
      title: `Queue head — #${head.number ?? "?"} ${head.title}`,
      text:
        head.stage === "ready"
          ? "The head of the queue is ready to land: its required gate is green, every check is finished, and it targets the default branch."
          : head.stage === "failing"
            ? "The head of the queue has failing checks. Nothing behind it can merge until it is fixed or removed — the queue is strictly in order."
            : head.stage === "checking"
              ? "The head of the queue is still being checked. The queue moves as soon as its checks finish."
              : "The head of the queue is waiting for its queue conditions — its stage line on the Queue tab says exactly which.",
      action: "See it in the queue",
      go: onOpenQueue,
    });
  }
  if (stats.failingPrs > 0) {
    attention.push({
      key: "failing",
      title: `${stats.failingPrs} pull request${stats.failingPrs === 1 ? "" : "s"} with failing checks`,
      text: "Each one names its failing checks. The author pushes a fix and the checks run again on the new commit.",
      action: "See the failing pull requests",
      go: onShowFailing,
    });
  }
  if (stats.drafts > 0) {
    attention.push({
      key: "drafts",
      title: `${stats.drafts} draft${stats.drafts === 1 ? "" : "s"} waiting on their authors`,
      text: "A draft cannot merge and stays out of the queue. Only its author can mark it ready for review.",
      action: "See them in the Inbox",
      go: onOpenInbox,
    });
  }
  if (conflicts > 0) {
    attention.push({
      key: "conflicts",
      title: `${conflicts} pull request${conflicts === 1 ? "" : "s"} with merge conflicts`,
      text: "The branch and the base branch changed the same lines. The author has to resolve the conflict before the pull request can move.",
      action: "See them in the Inbox",
      go: onOpenInbox,
    });
  }
  if (board.batch.blockedBy && board.batch.blockedBy.number !== null) {
    attention.push({
      key: "batch",
      title: "No batch is forming",
      text: `The batch planner stops at #${board.batch.blockedBy.number}${
        board.batch.blockedBy.title ? ` "${board.batch.blockedBy.title}"` : ""
      } — it cannot be batched yet, and nothing behind it can jump ahead of it.`,
      action: "Open the Queue tab",
      go: onOpenQueue,
    });
  }

  const stageTotal = Math.max(1, stats.openPrs);
  const pulseSegments = [
    { label: "ready", count: stats.readyPrs, className: "bg-emerald-400" },
    { label: "checking", count: stats.checkingPrs, className: "bg-amber-300" },
    { label: "failing", count: stats.failingPrs, className: "bg-rose-400" },
    { label: "in queue", count: stats.inQueuePrs, className: "bg-slate-500" },
  ];
  const authors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pr of board.pullRequests) {
      if (pr.author) counts.set(pr.author, (counts.get(pr.author) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([author, count]) => ({ author, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [board.pullRequests]);
  const topAuthorCount = authors.length > 0 ? authors[0].count : 1;

  const kpis: { label: string; help: string; value: string; share: number | null; sub: string }[] = [
    {
      label: "In the queue",
      help: "Pull requests waiting for their queue conditions: the required gate, finished checks, or their turn at the head.",
      value: String(stats.inQueuePrs),
      share: stats.openPrs > 0 ? stats.inQueuePrs / stats.openPrs : null,
      sub: "Waiting for their queue conditions — gate, checks, or their turn.",
    },
    {
      label: "Failing checks",
      help: "Pull requests with at least one failed check on their newest commit.",
      value: String(stats.failingPrs),
      share: stats.openPrs > 0 ? stats.failingPrs / stats.openPrs : null,
      sub: "Each one names the checks that failed, on its own row.",
    },
    {
      label: "Ready to land",
      help: "Ready only when the required gate reported green on the newest commit, every check is finished, the pull request targets the default branch, and it is not a draft.",
      value: String(stats.readyPrs),
      share: stats.openPrs > 0 ? stats.readyPrs / stats.openPrs : null,
      sub: `Gate green, checks finished, targeting ${board.defaultBranch || "the default branch"}.`,
    },
    {
      label: "Checks running",
      help: "Pull requests with at least one check still running or queued right now.",
      value: String(stats.checkingPrs),
      share: stats.openPrs > 0 ? stats.checkingPrs / stats.openPrs : null,
      sub: "At least one check still running or queued.",
    },
    {
      label: "Checks passed",
      help: "Across every open pull request, the share of reported checks that passed on the newest commits.",
      value: passedPct === null ? "—" : `${passedPct}%`,
      share: passedPct === null ? null : passedPct / 100,
      sub:
        totalChecks > 0
          ? `${passedChecks} of ${totalChecks} checks passed on the newest commits.`
          : "No checks have reported yet.",
    },
    {
      label: "Waiting on you",
      help: "Pull requests with something a person must do: a draft to mark ready, a conflict to resolve, a review to give, or a deployment to approve. The Inbox lists them all.",
      value: String(stats.waitingOnYou),
      share: stats.openPrs > 0 ? stats.waitingOnYou / stats.openPrs : null,
      sub: "The Inbox tab lists every one, with the reason.",
    },
  ];

  return (
    <div className="space-y-4">
      <div className={LC_PANEL}>
        <h2 className="font-semibold text-slate-100">
          {attention.length} thing{attention.length === 1 ? "" : "s"} need attention
        </h2>
        {attention.length === 0 ? (
          <p className="mt-1 text-sm text-slate-400">
            Nothing needs attention right now — no failing head, no conflicts, no drafts waiting.
            The queue is quiet.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-white/5">
            {attention.map((row) => (
              <li key={row.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-72">
                  <p className="break-words font-medium text-slate-100">{row.title}</p>
                  <p className="mt-0.5 text-sm text-slate-400">{row.text}</p>
                </div>
                <button type="button" onClick={row.go} className={LC_BTN}>
                  {row.action}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={LC_PANEL}>
        <h2 className="font-semibold text-slate-100">Queue pulse</h2>
        <div aria-hidden="true" className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
          {pulseSegments.map((segment) =>
            segment.count > 0 ? (
              <span
                key={segment.label}
                className={segment.className}
                style={{ width: `${(segment.count / stageTotal) * 100}%` }}
              />
            ) : null,
          )}
        </div>
        <p className="mt-2 text-sm text-slate-300">
          {stats.openPrs} active pull request{stats.openPrs === 1 ? "" : "s"} · {stats.readyPrs}{" "}
          ready · {stats.checkingPrs} checking · {stats.failingPrs} failing · {stats.inQueuePrs} in
          queue
        </p>
        <p className="mt-1 text-sm text-slate-400">
          {board.history.period.entered + board.history.period.merged + board.history.period.removed > 0
            ? `Last ${board.history.period.days || 14} days: ${board.history.period.entered} entered the queue · ${board.history.period.merged} merged · ${board.history.period.removed} removed. The Statistics tab has the day-by-day shape.`
            : "Merge history is being recorded — this line fills in as pull requests enter, merge, and leave the queue."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={LC_PANEL}>
          <h2 className="font-semibold text-slate-100">Summary</h2>
          <dl className="mt-2 space-y-2 text-sm">
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-slate-400">Repository</dt>
              <dd>
                <a href={githubRepoUrl(board.repoLabel)} target="_blank" rel="noreferrer" className="font-medium text-slate-100 underline-offset-2 hover:underline">
                  {board.repoLabel || "—"}
                </a>{" "}
                <span className="text-slate-500">— opens the repository on GitHub</span>
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-slate-400">Default branch</dt>
              <dd className="font-medium text-slate-100">{board.defaultBranch || "—"}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-slate-400">Batch size</dt>
              <dd className="text-slate-200">
                {board.batch.batchSize > 0
                  ? `Up to ${board.batch.batchSize} pull requests checked as one batch`
                  : "Not reported by the planner"}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-slate-400">Open pull requests</dt>
              <dd className="font-medium text-slate-100">{stats.openPrs}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-slate-400">Board data from</dt>
              <dd className="text-slate-200">
                {board.generatedAt ? formatRelativeTime(board.generatedAt) || "just now" : "—"}
                <span className="text-slate-500"> — the board re-reads GitHub every minute</span>
              </dd>
            </div>
          </dl>
        </div>
        <div className={LC_PANEL}>
          <h2 className="font-semibold text-slate-100">Top authors</h2>
          {authors.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">No open pull requests to count yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {authors.map((entry) => (
                <li key={entry.author} className="flex items-center gap-3 text-sm">
                  <span className="w-32 min-w-0 truncate font-medium text-slate-200">{entry.author}</span>
                  <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                    <span
                      className="block h-full bg-sky-400"
                      style={{ width: `${(entry.count / topAuthorCount) * 100}%` }}
                    />
                  </span>
                  <span className="text-slate-400">
                    {entry.count} PR{entry.count === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={LC_PANEL}>
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
              {kpi.label}
              <span
                title={kpi.help}
                aria-label={kpi.help}
                className="inline-block cursor-help rounded-full border border-white/15 px-1 text-[10px] leading-tight text-slate-300"
              >
                ?
              </span>
            </p>
            <p className="mt-1 text-3xl font-semibold text-slate-50">{kpi.value}</p>
            {kpi.share !== null ? (
              <div aria-hidden="true" className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-sky-400" style={{ width: `${Math.round(kpi.share * 100)}%` }} />
              </div>
            ) : null}
            <p className="mt-2 text-xs leading-relaxed text-slate-400">{kpi.sub}</p>
          </div>
        ))}
      </div>

      <div className={LC_PANEL}>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          How your queue works
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            {
              n: "01",
              title: "Put it in a batch",
              text: "The queue takes the first few ready pull requests and checks them together as one combined tree — the exact code that would exist if they all merged.",
            },
            {
              n: "02",
              title: "Check the batch as one tree",
              text: "One combined check costs a fraction of checking each pull request on its own, and it proves the combination works together, not just each part alone.",
            },
            {
              n: "03",
              title: "Split only on failure",
              text: "If the combined check fails, the batch splits in half and checks again, narrowing down to the one pull request that broke it — the rest keep moving.",
            },
          ].map((step) => (
            <div key={step.n}>
              <p className="text-sm font-bold text-sky-300">{step.n}</p>
              <p className="mt-1 font-semibold text-slate-100">{step.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{step.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={LC_PANEL}>
        <h2 className="font-semibold text-slate-100">Latest activity</h2>
        {board.runs.length === 0 ? (
          <p className="mt-1 text-sm text-slate-400">
            GitHub reports no recent workflow runs. Runs appear here as soon as a workflow starts.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-white/5">
            {board.runs.slice(0, 8).map((run) => {
              const glyph = runGlyph(run.status);
              return (
                <li key={run.runId ?? `${run.workflowName}-${run.updatedAt}`} className="flex items-start gap-3 py-2.5">
                  <span aria-hidden="true" className={`inline-block shrink-0 ${glyph.className}`}>
                    {glyph.glyph}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium text-slate-200">{run.workflowName}</p>
                    <p className="text-xs text-slate-400">
                      Commit {run.headSha ? run.headSha.slice(0, 7) : "—"} · {run.jobs.length} job
                      {run.jobs.length === 1 ? "" : "s"} · {run.status}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">{formatRelativeTime(run.updatedAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function PullRequestsView({
  board,
  filter,
  onFilterChange,
}: {
  board: LiveCenterBoardView;
  filter: LiveCenterBoardFilter;
  onFilterChange: (filter: LiveCenterBoardFilter) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => {
    const result: Record<LiveCenterBoardFilter, number> = {
      all: board.pullRequests.length,
      failing: 0,
      checking: 0,
      ready: 0,
      drafts: 0,
      waiting: 0,
    };
    for (const pr of board.pullRequests) {
      if (pr.stage === "failing") result.failing += 1;
      if (pr.stage === "checking") result.checking += 1;
      if (pr.stage === "ready") result.ready += 1;
      if (pr.draft) result.drafts += 1;
      if (pr.needsOwner) result.waiting += 1;
    }
    return result;
  }, [board.pullRequests]);

  const filtered = useMemo(
    () => filterLiveCenterPullRequests(board.pullRequests, query, filter),
    [board.pullRequests, query, filter],
  );
  const pageData = paginateList(filtered, page);

  return (
    <section aria-label="Pull requests" className="space-y-4">
      <div className={LC_PANEL}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Filter by number, title, or author — press / to jump here"
            aria-label="Filter pull requests by number, title, or author"
            className="min-w-0 flex-1 basis-56 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-300/50 focus:outline-none"
          />
          {PR_FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                onFilterChange(entry.id);
                setPage(1);
              }}
              aria-pressed={filter === entry.id}
              className={`inline-block rounded-full border px-3 py-1.5 text-sm transition ${
                filter === entry.id
                  ? "border-sky-300/40 bg-sky-400/15 font-semibold text-sky-100"
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {entry.label} <span className="text-xs text-slate-400">{counts[entry.id]}</span>
            </button>
          ))}
        </div>
        <details className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-200">
            What the labels mean
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">
            <li>
              <strong className="text-slate-200">Ready</strong> — the required gate reported green
              on the newest commit, every check finished, and the pull request targets the default
              branch. Only then can it land.
            </li>
            <li>
              <strong className="text-slate-200">Checking</strong> — at least one check is still
              running or queued.
            </li>
            <li>
              <strong className="text-slate-200">Failing</strong> — at least one check failed. The
              row names them; expand the checks line to see every check.
            </li>
            <li>
              <strong className="text-slate-200">In queue</strong> — waiting for its queue
              conditions: the gate, the checks, or its turn. A required gate that has not
              reported yet is a wait, never a pass.
            </li>
            <li>
              <strong className="text-slate-200">Draft</strong> — cannot merge; only its author
              can mark it ready for review.
            </li>
            <li>
              <strong className="text-slate-200">Stack child</strong> — builds on another pull
              request&rsquo;s branch instead of the default branch. It joins the queue properly
              once its parent lands.
            </li>
            <li>
              <strong className="text-slate-200">Waiting on you</strong> — something on it needs a
              person. The Inbox tab lists exactly what.
            </li>
            <li>
              <strong className="text-slate-200">Conflicts</strong> — the branch and the base
              branch changed the same lines; the author has to resolve it.
            </li>
          </ul>
        </details>

        {pageData.items.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            {board.pullRequests.length === 0
              ? "No open pull requests right now. When someone opens one, it appears here and the checks start on their own."
              : "No pull requests match this search and filter. Clear the search, or pick a different filter above."}
          </p>
        ) : (
          <>
            <div className="mt-2 divide-y divide-white/5">
              {pageData.items.map((pr) => (
                <PrRow key={pr.number ?? pr.title} pr={pr} repoLabel={board.repoLabel} />
              ))}
            </div>
            <LcPager
              page={pageData.page}
              pages={pageData.pages}
              total={pageData.total}
              noun="pull requests"
              onPage={setPage}
            />
          </>
        )}
      </div>
    </section>
  );
}

export function LiveCenterBoard() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [board, setBoard] = useState<LiveCenterBoardView | null>(null);
  const [minutes, setMinutes] = useState<LiveCenterMinutesView | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabId>("overview");
  const [prFilter, setPrFilter] = useState<LiveCenterBoardFilter>("all");
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState("");
  const startedRef = useRef(false);
  const refreshingRef = useRef(false);
  const pausedRef = useRef(false);
  const frozenRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // The interval callback reads the current pause/freeze state through
  // refs; they are synced in an effect, never during render.
  useEffect(() => {
    pausedRef.current = paused;
    frozenRef.current = frozen;
  }, [paused, frozen]);

  function handleLoadError(caught: unknown) {
    if (caught instanceof CustomerApiError && caught.status === 503 && caught.code === "mgov_not_configured") {
      setPhase("not-configured");
      return;
    }
    if (caught instanceof CustomerApiError && caught.status === 401) {
      setPhase("signed-out");
      return;
    }
    setError(caught instanceof Error ? caught.message : "The Live Center could not be loaded.");
    setPhase("error");
  }

  async function loadMinutes() {
    try {
      const raw = await customerApi<unknown>(API_BASE, "/customer/live-center/minutes", { method: "GET" });
      setMinutes(normalizeLiveCenterMinutes(raw));
    } catch {
      // Minutes are best-effort: the tab renders its not-configured
      // state and the board is unaffected.
      setMinutes(normalizeLiveCenterMinutes(null));
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;

    async function load() {
      try {
        // The session gate comes first, exactly like the other
        // account pages: this call fails with 401 invalid_session
        // unless the customer is signed in, and the board is never
        // requested without a proven session. There is no guest view.
        await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
        const raw = await customerApi<unknown>(API_BASE, "/customer/live-center/board", { method: "GET" });
        if (!active) return;
        setBoard(normalizeLiveCenterBoard(raw));
        setPhase("ready");
        void loadMinutes();
      } catch (caught) {
        if (!active) return;
        handleLoadError(caught);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  async function refresh(manual: boolean) {
    if (refreshingRef.current) return;
    if (frozenRef.current) {
      if (manual) setRefreshNote("This page is frozen on the snapshot below — unfreeze it to see fresh numbers.");
      return;
    }
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const raw = await customerApi<unknown>(API_BASE, "/customer/live-center/board", { method: "GET" });
      setBoard(normalizeLiveCenterBoard(raw));
      setRefreshNote("");
      void loadMinutes();
    } catch (caught) {
      if (caught instanceof CustomerApiError && (caught.status === 401 || (caught.status === 503 && caught.code === "mgov_not_configured"))) {
        handleLoadError(caught);
      } else {
        setRefreshNote("Couldn't refresh just now — showing the last good board.");
      }
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (phase !== "ready") return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (pausedRef.current || frozenRef.current) return;
      void refresh(false);
    }, REFRESH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Animations pause while the board is scrolled off-screen, so a
  // long page left open does not burn cycles (the .lc-paused rules
  // live with the other lc- classes in globals.css).
  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          node.classList.toggle("lc-paused", !entry.isIntersecting);
        }
      },
      { threshold: 0.02 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [phase]);

  const tabCounter = (id: TabId): string | null => {
    if (!board) return null;
    switch (id) {
      case "prs":
        return String(board.stats.openPrs);
      case "queue":
        return String(board.stats.openPrs);
      case "runs":
        return String(board.runs.length);
      case "runners":
        return String(board.runners.busyCount);
      case "inbox":
        return String(board.stats.waitingOnYou);
      case "minutes": {
        if (!minutes?.configured) return null;
        const total = minutes.balances.reduce((sum, balance) => sum + (balance.minutesLeft ?? 0), 0);
        return total > 0 ? total.toLocaleString("en-US") : null;
      }
      default:
        return null;
    }
  };

  if (phase === "loading") {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10 text-slate-300 sm:px-6 lg:px-8">
        <p className="text-sm">
          Loading your Live Center — first proving your session, then fetching the newest board
          from GitHub.
        </p>
      </main>
    );
  }

  if (phase === "signed-out") {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10 text-slate-300 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-white">You are signed out</h1>
        <p className="mt-2 max-w-xl text-sm text-slate-400">
          Sign in to see your Live Center. There is no guest view — the board shows your
          repositories&rsquo; private merge queue, so it only ever renders behind your session.
        </p>
        <p className="mt-4">
          <Link href="/account/" className={LC_BTN}>
            Go to your account to sign in
          </Link>
        </p>
      </main>
    );
  }

  if (phase === "not-configured") {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10 text-slate-300 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-white">Live Center is not switched on yet</h1>
        <p className="mt-2 max-w-xl text-sm text-slate-400">
          This account&rsquo;s Live Center has not been connected to a repository yet, so there is
          no queue to show. Connecting a repository is what turns it on — the board then fills
          with that repository&rsquo;s pull requests, checks, runners, and minutes on its own.
        </p>
        <p className="mt-4">
          <Link href="/account/" className={LC_BTN}>
            Back to your account
          </Link>
        </p>
      </main>
    );
  }

  if (phase === "error" || !board) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10 text-slate-300 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-white">The Live Center could not be loaded</h1>
        <p className="mt-2 max-w-xl text-sm text-slate-400">
          {error || "Something went wrong while loading the board."} Nothing about your
          repositories changed — this page simply could not read the board just now.
        </p>
        <p className="mt-4">
          <button type="button" onClick={() => window.location.reload()} className={LC_BTN}>
            Reload the page to try again
          </button>
        </p>
      </main>
    );
  }

  const activeTabLabel = TABS.find((entry) => entry.id === tab)?.label ?? "Overview";

  return (
    <main className="w-full bg-[#0a0e1a] text-slate-200">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div ref={wrapRef}>
        <Link href="/account/" className="text-sm text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline">
          ← Back to your account
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl">
            <p className="text-xs text-slate-500">Live Center › {activeTabLabel}</p>
            <h1 className="mt-0.5 text-2xl font-bold text-white">Live Center</h1>
            <p className="mt-1 text-sm text-slate-400">
              Your merge queue, checks, runners, and minutes for{" "}
              <a
                href={githubRepoUrl(board.repoLabel)}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-slate-200 underline-offset-2 hover:underline"
              >
                {board.repoLabel || "your repository"}
              </a>{" "}
              — this page refreshes itself every minute
              {board.generatedAt ? `; this board is from ${formatRelativeTime(board.generatedAt) || "just now"}` : ""}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              aria-pressed={paused}
              title="Pauses the automatic refresh — the numbers stay as they are until you resume or press Refresh. The queue itself is not paused."
              className={LC_BTN}
            >
              {paused ? "Resume refresh" : "Pause"}
            </button>
            <button
              type="button"
              onClick={() => setFrozen((value) => !value)}
              aria-pressed={frozen}
              title="Freezes this page on the snapshot you are looking at now — nothing on the page changes until you unfreeze. Good for comparing numbers side by side."
              className={LC_BTN}
            >
              {frozen ? "Unfreeze" : "Freeze"}
            </button>
            <button
              type="button"
              onClick={() => void refresh(true)}
              disabled={refreshing}
              title="Fetches the newest board from GitHub right now, instead of waiting for the next automatic refresh."
              className={`${LC_BTN} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {frozen ? (
          <p className="mt-3 rounded-xl border border-sky-300/25 bg-sky-400/[0.07] px-3 py-2 text-sm text-sky-100">
            This page is frozen on the snapshot from{" "}
            {board.generatedAt ? formatRelativeTime(board.generatedAt) || "just now" : "this load"} —
            the numbers cannot move while you compare them. Unfreeze to see fresh numbers.
          </p>
        ) : null}
        {paused && !frozen ? (
          <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
            Automatic refresh is paused — you are reading the board as it was. Press Resume refresh
            or Refresh to see the newest numbers.
          </p>
        ) : null}
        {refreshNote ? (
          <p className="mt-3 rounded-xl border border-amber-300/25 bg-amber-400/[0.07] px-3 py-2 text-sm text-amber-100">
            {refreshNote}
          </p>
        ) : null}

        <nav aria-label="Live Center views" className="mt-5 flex flex-wrap gap-1 border-y border-white/10 py-2">
          {TABS.map((entry) => {
            const counter = tabCounter(entry.id);
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-current={tab === entry.id ? "page" : undefined}
                className={`inline-block rounded-lg px-3 py-1.5 text-sm transition ${
                  tab === entry.id
                    ? "bg-sky-400/15 font-semibold text-sky-100"
                    : "text-slate-300 hover:bg-white/5"
                }`}
              >
                {entry.label}
                {counter !== null ? <span className="ml-1.5 text-xs text-slate-400">{counter}</span> : null}
              </button>
            );
          })}
        </nav>

        <div className="mt-5">
          {tab === "overview" ? (
            <Overview
              board={board}
              onShowFailing={() => {
                setPrFilter("failing");
                setTab("prs");
              }}
              onOpenQueue={() => setTab("queue")}
              onOpenInbox={() => setTab("inbox")}
            />
          ) : null}
          {tab === "prs" ? (
            <PullRequestsView board={board} filter={prFilter} onFilterChange={setPrFilter} />
          ) : null}
          {tab === "queue" ? <LiveCenterQueue board={board} /> : null}
          {tab === "runs" ? <LiveCenterRuns board={board} /> : null}
          {tab === "runners" ? <LiveCenterRunners board={board} /> : null}
          {tab === "stats" ? <LiveCenterStats board={board} /> : null}
          {tab === "inbox" ? <LiveCenterInbox board={board} /> : null}
          {tab === "minutes" && minutes ? <LiveCenterMinutes minutes={minutes} /> : null}
          {tab === "minutes" && !minutes ? (
            <p className="text-sm text-slate-400">Loading your minutes…</p>
          ) : null}
        </div>
      </div>
      </div>
    </main>
  );
}
