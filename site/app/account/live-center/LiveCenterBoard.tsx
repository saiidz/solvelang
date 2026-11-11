"use client";

import Link from "next/link";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import {
  CustomerApiError,
  type CustomerDashboard,
  customerApi,
  normalizeApiBase,
} from "@/app/account/core/customer-api";
import {
  type LiveCenterBoardView,
  type LiveCenterOwnerActionGroup,
  type LiveCenterPullRequest,
  type LiveCenterPullRequestFilter,
  type LiveCenterStage,
  filterLiveCenterPullRequests,
  normalizeLiveCenterBoard,
} from "@/app/account/core/live-center";
import { LiveCenterPipeline } from "@/app/account/live-center/LiveCenterPipeline";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);

type Phase = "loading" | "ready" | "not-configured" | "signed-out" | "error";

const PR_PAGE = 10;
const ACTIVITY_PAGE = 10;
const GROUP_PAGE = 6;
const GROUP_ITEMS_PAGE = 10;
const REFRESH_MS = 60_000;

const STAGE_LABELS: Record<LiveCenterStage, string> = {
  queue: "In queue",
  checking: "Checking",
  failing: "Failing",
  ready: "Ready",
};

const STAGE_BADGE_CLASSES: Record<LiveCenterStage, string> = {
  queue: "border-white/15 bg-white/5 text-slate-200",
  checking: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  failing: "border-red-400/30 bg-red-400/10 text-red-100",
  ready: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
};

const FILTERS: { id: LiveCenterPullRequestFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "failing", label: "Failing" },
  { id: "drafts", label: "Drafts" },
  { id: "waiting", label: "Waiting on me" },
];

function prHeading(number: number | null, title: string): string {
  const label = number !== null ? `#${number}` : "PR";
  return title ? `${label} ${title}` : label;
}

function statusPillClasses(status: string): string {
  if (status === "Running") return "border-cyan-300/30 bg-cyan-300/10 text-cyan-100";
  if (status === "Passed") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  if (status === "Failed") return "border-red-400/30 bg-red-400/10 text-red-100";
  return "border-white/15 bg-white/5 text-slate-200";
}

function PullRequestRow({
  pr,
  changed,
  failingExpanded,
  onToggleFailing,
}: {
  pr: LiveCenterPullRequest;
  changed: boolean;
  failingExpanded: boolean;
  onToggleFailing: () => void;
}) {
  const shownFailing = failingExpanded ? pr.failing : pr.failing.slice(0, 3);
  return (
    <li className={`lc-chip ${changed ? "lc-enter" : ""} rounded-2xl bg-slate-900/60 px-5 py-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold text-white">
          <span className="mr-2 text-cyan-300">{pr.number !== null ? `#${pr.number}` : "PR"}</span>
          {pr.title || "Untitled pull request"}
        </p>
        <span className="flex flex-wrap gap-1.5">
          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${STAGE_BADGE_CLASSES[pr.stage]}`}>
            {STAGE_LABELS[pr.stage]}
          </span>
          <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-bold text-slate-200">
            Queue #{pr.position}
          </span>
          {pr.draft ? (
            <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-300">
              Draft
            </span>
          ) : null}
          {pr.needsOwner ? (
            <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-0.5 text-[11px] font-bold text-cyan-100">
              Waiting on you
            </span>
          ) : null}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-300">
        {pr.author ? <span className="mr-1">by {pr.author}</span> : null}
        {pr.total > 0 ? (
          <>
            <span className="rounded-full bg-white/5 px-2.5 py-0.5">{pr.passed}/{pr.total} checks passed</span>
            {pr.failed > 0 ? <span className="rounded-full bg-red-400/10 px-2.5 py-0.5 text-red-200">{pr.failed} failing</span> : null}
            {pr.pending > 0 ? <span className="rounded-full bg-amber-300/10 px-2.5 py-0.5 text-amber-100">{pr.pending} running</span> : null}
          </>
        ) : (
          <span className="rounded-full bg-white/5 px-2.5 py-0.5">No checks reported yet</span>
        )}
      </div>
      {pr.failing.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {shownFailing.map((name) => (
            <span key={name} className="rounded-full border border-red-400/20 bg-red-400/5 px-2.5 py-0.5 text-[11px] font-medium text-red-200">
              {name}
            </span>
          ))}
          {pr.failing.length > 3 ? (
            <button
              type="button"
              onClick={onToggleFailing}
              className="rounded-full border border-white/15 px-2.5 py-0.5 text-[11px] font-bold text-slate-200 hover:bg-white/10"
            >
              {failingExpanded ? "Show fewer" : `+${pr.failing.length - 3} more`}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function OwnerActionGroupRow({
  group,
  expanded,
  showAllItems,
  onToggle,
  onShowAllItems,
}: {
  group: LiveCenterOwnerActionGroup;
  expanded: boolean;
  showAllItems: boolean;
  onToggle: () => void;
  onShowAllItems: () => void;
}) {
  const items = showAllItems ? group.items : group.items.slice(0, GROUP_ITEMS_PAGE);
  return (
    <li className="rounded-2xl bg-slate-900/60 px-5 py-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full flex-wrap items-baseline justify-between gap-3 text-left"
      >
        <span className="text-sm font-semibold text-white">
          <span className="mr-2 rounded-full bg-cyan-300/15 px-2.5 py-0.5 text-xs font-bold text-cyan-100">{group.items.length} ×</span>
          {group.label || "Waiting on your decision."}
        </span>
        <span className="text-xs font-bold text-cyan-200">{expanded ? "Hide" : "Show"} pull requests</span>
      </button>
      {expanded ? (
        <ul className="mt-3 space-y-2 border-t border-white/10 pt-3">
          {items.map((item, index) => (
            <li key={`${item.number ?? "pr"}-${index}`} className="text-sm text-slate-200">
              <span className="font-semibold text-white">{prHeading(item.number, item.title)}</span>
              {item.failing.length > 0 ? (
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {item.failing.slice(0, 4).map((name) => (
                    <span key={name} className="rounded-full border border-red-400/20 bg-red-400/5 px-2.5 py-0.5 text-[11px] font-medium text-red-200">
                      {name}
                    </span>
                  ))}
                  {item.failing.length > 4 ? (
                    <span className="px-1 py-0.5 text-[11px] font-medium text-slate-400">+{item.failing.length - 4} more</span>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {expanded && !showAllItems && group.items.length > GROUP_ITEMS_PAGE ? (
        <button type="button" onClick={onShowAllItems} className="mt-3 text-xs font-bold text-cyan-200 hover:text-cyan-100">
          Show all {group.items.length} pull requests
        </button>
      ) : null}
    </li>
  );
}

export function LiveCenterBoard() {
  const startedRef = useRef(false);
  const prevStagesRef = useRef<Map<number, LiveCenterStage>>(new Map());
  const changedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [board, setBoard] = useState<LiveCenterBoardView | null>(null);
  const [error, setError] = useState("");
  const [refreshNote, setRefreshNote] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [changedNumbers, setChangedNumbers] = useState<ReadonlySet<number>>(new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LiveCenterPullRequestFilter>("all");
  const [prLimit, setPrLimit] = useState(PR_PAGE);
  const [activityLimit, setActivityLimit] = useState(ACTIVITY_PAGE);
  const [groupLimit, setGroupLimit] = useState(GROUP_PAGE);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  const [fullGroups, setFullGroups] = useState<ReadonlySet<string>>(new Set());
  const [expandedFailing, setExpandedFailing] = useState<ReadonlySet<number>>(new Set());

  function applyBoard(view: LiveCenterBoardView) {
    const changed = new Set<number>();
    for (const pr of view.pullRequests) {
      if (pr.number === null) continue;
      const previous = prevStagesRef.current.get(pr.number);
      if (previous !== undefined && previous !== pr.stage) changed.add(pr.number);
      prevStagesRef.current.set(pr.number, pr.stage);
    }
    setBoard(view);
    if (changed.size > 0) {
      setChangedNumbers(changed);
      if (changedTimeoutRef.current) clearTimeout(changedTimeoutRef.current);
      changedTimeoutRef.current = setTimeout(() => setChangedNumbers(new Set()), 3600);
    }
  }

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

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;

    async function load() {
      try {
        // The session gate comes first, exactly like the other account
        // pages: this call fails with 401 invalid_session unless the
        // customer is signed in, and the board is never requested
        // without a proven session. There is no guest view.
        await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
        const raw = await customerApi<unknown>(API_BASE, "/customer/live-center/board", { method: "GET" });
        if (!active) return;
        applyBoard(normalizeLiveCenterBoard(raw));
        setPhase("ready");
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

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const raw = await customerApi<unknown>(API_BASE, "/customer/live-center/board", { method: "GET" });
      applyBoard(normalizeLiveCenterBoard(raw));
      setRefreshNote("");
    } catch (caught) {
      if (caught instanceof CustomerApiError && (caught.status === 401 || (caught.status === 503 && caught.code === "mgov_not_configured"))) {
        handleLoadError(caught);
      } else {
        setRefreshNote("Couldn't refresh just now — showing the last good board.");
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (phase !== "ready") return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    return () => {
      if (changedTimeoutRef.current) clearTimeout(changedTimeoutRef.current);
    };
  }, []);

  const filteredPrs = useMemo(
    () => (board ? filterLiveCenterPullRequests(board.pullRequests, query, filter) : []),
    [board, query, filter],
  );
  const filterCounts = useMemo(() => {
    const counts: Record<LiveCenterPullRequestFilter, number> = { all: 0, failing: 0, drafts: 0, waiting: 0 };
    if (board) {
      counts.all = board.pullRequests.length;
      counts.failing = board.pullRequests.filter((pr) => pr.stage === "failing").length;
      counts.drafts = board.pullRequests.filter((pr) => pr.draft).length;
      counts.waiting = board.pullRequests.filter((pr) => pr.needsOwner).length;
    }
    return counts;
  }, [board]);

  const generatedLabel = useMemo(() => {
    if (!board?.generatedAt) return "";
    const when = new Date(board.generatedAt);
    return Number.isNaN(when.getTime()) ? "" : when.toLocaleString();
  }, [board]);

  function toggleSet(setter: Dispatch<SetStateAction<ReadonlySet<string>>>, key: string) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const tiles = board
    ? [
        { label: "Open PRs", value: board.stats.openPrs, classes: "text-white" },
        { label: "Drafts", value: board.stats.drafts, classes: "text-white" },
        { label: "Failing checks", value: board.stats.failingPrs, classes: board.stats.failingPrs > 0 ? "text-red-300" : "text-white" },
        { label: "Checking", value: board.stats.checkingPrs, classes: "text-white" },
        { label: "Ready", value: board.stats.readyPrs, classes: board.stats.readyPrs > 0 ? "text-emerald-300" : "text-white" },
        { label: "Waiting on you", value: board.stats.waitingOnOwner, classes: board.stats.waitingOnOwner > 0 ? "text-cyan-300" : "text-white" },
      ]
    : [];

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/account/api-keys/" className="text-sm font-semibold text-slate-300 hover:text-white">
          Back to your account
        </Link>

        <header className="mt-8">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">SolveLang Process Solution</p>
          <h1 className="mt-3 text-3xl font-bold">Live Center</h1>
          <p className="mt-3 max-w-2xl text-slate-300">
            Your merge queue, pull request checks, runners, and everything waiting on you
            {board?.repoLabel ? <> for <strong className="text-white">{board.repoLabel}</strong></> : null} — in one place.
          </p>
          {phase === "ready" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-400">
              <span className="flex items-center gap-2">
                <span className="lc-pulse-dot inline-block h-2 w-2 rounded-full bg-emerald-300" />
                Live — refreshes every minute
              </span>
              {generatedLabel ? <span>Board generated {generatedLabel}</span> : null}
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                className="rounded-full border border-white/15 px-3 py-1 font-bold text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                {refreshing ? "Refreshing…" : "Refresh now"}
              </button>
              {refreshNote ? <span className="text-amber-200">{refreshNote}</span> : null}
            </div>
          ) : null}
        </header>

        {phase === "loading" ? (
          <div className="mt-10 grid min-h-[240px] place-items-center rounded-[2rem] border border-white/10 bg-white/5 text-sm font-medium text-slate-300">
            Loading your Live Center…
          </div>
        ) : null}

        {phase === "not-configured" ? (
          <div className="mt-10 rounded-[2rem] border border-white/10 bg-white/5 p-7 text-slate-200">
            <h2 className="text-xl font-bold text-white">Live Center is not switched on yet</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              The Live Center is not switched on for this account yet. When your repository is connected and
              governance is running, your queue, checks, runners, and open actions will appear here.
            </p>
          </div>
        ) : null}

        {phase === "signed-out" ? (
          <div className="mt-10 rounded-[2rem] border border-white/10 bg-white/5 p-7 text-slate-200">
            <h2 className="text-xl font-bold text-white">Sign in to see your Live Center</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Your session has ended. <Link className="underline" href="/account/api-keys/">Sign in from your account page</Link> and
              this board will load with your queue.
            </p>
          </div>
        ) : null}

        {phase === "error" ? (
          <div role="alert" className="mt-10 rounded-[2rem] border border-red-300/30 bg-red-500/10 p-7 text-sm font-medium text-red-100">
            <p>{error || "The Live Center could not be loaded. Try again in a moment."}</p>
          </div>
        ) : null}

        {phase === "ready" && board ? (
          <div className="mt-10 grid gap-8">
            <section aria-label="Board summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {tiles.map((tile) => (
                <div key={tile.label} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className={`text-3xl font-bold ${tile.classes}`}>{tile.value}</p>
                  <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{tile.label}</p>
                </div>
              ))}
            </section>

            <section aria-labelledby="live-center-queue" className="rounded-[2rem] border border-white/10 bg-white/5 p-7">
              <h2 id="live-center-queue" className="text-xl font-bold">Merge queue</h2>
              {board.pullRequests.length === 0 ? (
                <p className="mt-4 text-sm text-slate-300">The merge queue is empty. Nothing is waiting to land.</p>
              ) : (
                <div className="mt-5">
                  <LiveCenterPipeline pullRequests={board.pullRequests} batch={board.batch} changedNumbers={changedNumbers} />
                </div>
              )}
            </section>

            <section aria-labelledby="live-center-prs" className="rounded-[2rem] border border-white/10 bg-white/5 p-7">
              <h2 id="live-center-prs" className="text-xl font-bold">Pull requests</h2>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPrLimit(PR_PAGE);
                  }}
                  placeholder="Search by number, title, or author"
                  aria-label="Search pull requests"
                  className="min-w-[220px] flex-1 rounded-full border border-white/10 bg-slate-900/60 px-4 py-2 text-sm text-white placeholder:text-slate-500"
                />
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setFilter(item.id);
                      setPrLimit(PR_PAGE);
                    }}
                    aria-pressed={filter === item.id}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-bold ${
                      filter === item.id
                        ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                        : "border-white/15 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    {item.label} · {filterCounts[item.id]}
                  </button>
                ))}
              </div>
              {filteredPrs.length === 0 ? (
                <p className="mt-5 text-sm text-slate-300">
                  {board.pullRequests.length === 0
                    ? "No open pull requests are being governed right now."
                    : "No pull requests match this search and filter."}
                </p>
              ) : (
                <>
                  <ul className="mt-5 space-y-3">
                    {filteredPrs.slice(0, prLimit).map((pr, index) => (
                      <PullRequestRow
                        key={`${pr.number ?? "pr"}-${index}`}
                        pr={pr}
                        changed={pr.number !== null && changedNumbers.has(pr.number)}
                        failingExpanded={pr.number !== null && expandedFailing.has(pr.number)}
                        onToggleFailing={() => {
                          if (pr.number === null) return;
                          const number = pr.number;
                          setExpandedFailing((current) => {
                            const next = new Set(current);
                            if (next.has(number)) next.delete(number);
                            else next.add(number);
                            return next;
                          });
                        }}
                      />
                    ))}
                  </ul>
                  <p className="mt-4 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-400">
                    <span>Showing {Math.min(prLimit, filteredPrs.length)} of {filteredPrs.length}</span>
                    {prLimit < filteredPrs.length ? (
                      <button type="button" onClick={() => setPrLimit((limit) => limit + PR_PAGE)} className="font-bold text-cyan-200 hover:text-cyan-100">
                        Show more
                      </button>
                    ) : null}
                    {prLimit > PR_PAGE ? (
                      <button type="button" onClick={() => setPrLimit(PR_PAGE)} className="font-bold text-slate-300 hover:text-white">
                        Show less
                      </button>
                    ) : null}
                  </p>
                </>
              )}
            </section>

            <section aria-labelledby="live-center-runners" className="rounded-[2rem] border border-white/10 bg-white/5 p-7">
              <h2 id="live-center-runners" className="text-xl font-bold">Runners at work</h2>
              {board.activity.length === 0 ? (
                <p className="mt-4 text-sm text-slate-300">No jobs are running right now.</p>
              ) : (
                <>
                  <ul className="mt-5 space-y-3">
                    {board.activity.slice(0, activityLimit).map((row, index) => (
                      <li
                        key={`${row.runId ?? "run"}-${row.name}-${index}`}
                        className="lc-chip flex flex-wrap items-baseline justify-between gap-3 rounded-2xl bg-slate-900/60 px-5 py-4"
                      >
                        <span className="min-w-0 text-sm font-semibold text-white">
                          {row.name}
                          {row.workflowName && row.workflowName !== row.name ? (
                            <span className="ml-2 text-xs font-medium text-slate-400">{row.workflowName}</span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-2 text-sm text-slate-300">
                          <span>{row.runnerName ? <>on {row.runnerName}</> : "waiting for a runner"}</span>
                          {row.status ? (
                            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusPillClasses(row.status)}`}>
                              {row.status === "Running" ? <span className="lc-pulse-dot mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-cyan-200 align-middle" /> : null}
                              {row.status}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-400">
                    <span>Showing {Math.min(activityLimit, board.activity.length)} of {board.activity.length}</span>
                    {activityLimit < board.activity.length ? (
                      <button type="button" onClick={() => setActivityLimit((limit) => limit + ACTIVITY_PAGE)} className="font-bold text-cyan-200 hover:text-cyan-100">
                        Show more
                      </button>
                    ) : null}
                    {activityLimit > ACTIVITY_PAGE ? (
                      <button type="button" onClick={() => setActivityLimit(ACTIVITY_PAGE)} className="font-bold text-slate-300 hover:text-white">
                        Show less
                      </button>
                    ) : null}
                  </p>
                </>
              )}
            </section>

            <section aria-labelledby="live-center-actions" className="rounded-[2rem] border border-cyan-300/20 bg-gradient-to-b from-cyan-300/10 to-white/5 p-7">
              <h2 id="live-center-actions" className="text-xl font-bold">Needed from you</h2>
              {board.ownerActionGroups.length === 0 ? (
                <p className="mt-4 text-sm text-slate-300">Nothing is waiting on you. The queue can move without you.</p>
              ) : (
                <>
                  <ul className="mt-5 space-y-3">
                    {board.ownerActionGroups.slice(0, groupLimit).map((group) => (
                      <OwnerActionGroupRow
                        key={group.key}
                        group={group}
                        expanded={expandedGroups.has(group.key)}
                        showAllItems={fullGroups.has(group.key)}
                        onToggle={() => toggleSet(setExpandedGroups, group.key)}
                        onShowAllItems={() => toggleSet(setFullGroups, group.key)}
                      />
                    ))}
                  </ul>
                  {groupLimit < board.ownerActionGroups.length ? (
                    <button type="button" onClick={() => setGroupLimit((limit) => limit + GROUP_PAGE)} className="mt-4 text-xs font-bold text-cyan-200 hover:text-cyan-100">
                      Show more kinds of actions
                    </button>
                  ) : null}
                </>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
