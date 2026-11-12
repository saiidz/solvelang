"use client";

// The Queue tab: every open pull request in merge order, plus the
// Merged and Removed history the pilot now records. Pause and Freeze
// (in the header) are explained where the customer meets them — this
// view's own intro line — because the two words mean different
// things: pausing stops new batches from forming; freezing stops
// merges from landing as well.

import { useMemo, useState } from "react";
import {
  type LiveCenterBoardView,
  formatDurationMs,
  formatRelativeTime,
  paginateList,
} from "@/app/account/core/live-center";
import { LC_PANEL, LcEmpty, LcPager, PrRow, githubPrUrl } from "@/app/account/live-center/LiveCenterPrRows";

type QueueTab = "queued" | "merged" | "removed";

export function LiveCenterQueue({ board }: { board: LiveCenterBoardView }) {
  const [tab, setTab] = useState<QueueTab>("queued");
  const [page, setPage] = useState(1);
  const ready = board.pullRequests.filter((pr) => pr.stage === "ready");
  const waiting = board.pullRequests.filter((pr) => pr.stage === "queue");
  const pageData = paginateList(board.pullRequests, page);
  const merged = board.history.merged;
  const removed = board.history.removed;
  const batch = board.batch;

  const tabBtn = (id: QueueTab, label: string, count: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`inline-block rounded-lg px-3 py-1.5 text-sm transition ${
        tab === id
          ? "bg-sky-400/15 font-semibold text-sky-100"
          : "text-slate-300 hover:bg-white/5"
      }`}
    >
      {label}
      <span className="ml-1.5 text-xs text-slate-400">{count}</span>
    </button>
  );

  const formingNote = useMemo(() => {
    if (batch.proposed) {
      return `A batch of ${batch.size} is forming at the head of the queue: ${batch.members
        .map((member) => `#${member.number ?? "?"}`)
        .join(", ")}. The batch is checked as one tree; if the combined check fails, it splits to find the pull request that broke it.`;
    }
    if (batch.blockedBy && batch.blockedBy.number !== null) {
      return `No batch is forming. The head of the queue, #${batch.blockedBy.number}${
        batch.blockedBy.title ? ` "${batch.blockedBy.title}"` : ""
      }, cannot be batched yet — the Overview's attention list says what it is waiting on. Nothing behind it can jump ahead of it.`;
    }
    return "No batch is forming right now. Batches form from the head of the queue down, as soon as the head can be batched.";
  }, [batch]);

  return (
    <section aria-label="Merge queue" className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-400">
        The queue is the order pull requests will merge in, head first.{" "}
        <strong className="text-slate-200">Pause</strong> (in the header) stops this page from
        refreshing while you read it. <strong className="text-slate-200">Freeze</strong> pins this
        page to the snapshot you are looking at now, so the numbers cannot move while you compare
        them. The queue itself is governed by your repository&rsquo;s merge rules — these two
        controls change only what this page shows you.
      </p>

      <div className={`${LC_PANEL}`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
            {tabBtn("queued", "Queued", board.pullRequests.length)}
            {tabBtn("merged", "Merged", merged.length)}
            {tabBtn("removed", "Removed", removed.length)}
          </div>
          <p className="ml-auto text-xs text-slate-400">
            Queue for {board.defaultBranch || "the default branch"} ·{" "}
            {board.runners.busyCount} runner{board.runners.busyCount === 1 ? "" : "s"} busy ·{" "}
            {board.runners.waitingCount} job{board.runners.waitingCount === 1 ? "" : "s"} waiting
            for a runner
          </p>
        </div>

        {tab === "queued" ? (
          <>
            <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-400/[0.06] px-3 py-2 text-sm text-slate-300">
              <strong className="text-emerald-300">{ready.length} ready to queue</strong>
              {" · "}
              {waiting.length} waiting for their queue conditions — a pull request is ready only
              when its required gate has reported green on the newest commit, every check is
              finished, and it targets {board.defaultBranch || "the default branch"} directly.
            </div>
            <p className="mt-3 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-3 py-2 text-sm text-slate-400">
              {formingNote}
            </p>
            {pageData.items.length === 0 ? (
              <div className="mt-4">
                <LcEmpty title="The queue is empty">
                  <p>
                    No open pull requests are waiting to merge. When someone opens one, it appears
                    here in queue order and the checks start on their own.
                  </p>
                </LcEmpty>
              </div>
            ) : (
              <>
                <div className="mt-2 divide-y divide-white/5">
                  {pageData.items.map((pr) => (
                    <PrRow key={pr.number ?? pr.title} pr={pr} repoLabel={board.repoLabel} showPosition />
                  ))}
                </div>
                <LcPager
                  page={pageData.page}
                  pages={pageData.pages}
                  total={pageData.total}
                  noun="pull requests in the queue"
                  onPage={setPage}
                />
              </>
            )}
          </>
        ) : null}

        {tab === "merged" ? (
          merged.length === 0 ? (
            <div className="mt-4">
              <LcEmpty title="No merges recorded yet">
                <p>
                  Merges are recorded from the moment queue history switched on. Nothing is
                  back-filled or guessed — when the first governed pull request lands, it appears
                  here with the time it spent in the queue.
                </p>
              </LcEmpty>
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-white/5">
              {merged.map((entry) => (
                <li key={`${entry.number}-${entry.at}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  <span aria-hidden="true" className="text-emerald-400">✓</span>
                  <a
                    href={githubPrUrl(board.repoLabel, entry.number)}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 break-words font-semibold text-slate-100 underline-offset-2 hover:underline"
                  >
                    {entry.title || "Untitled pull request"}
                  </a>
                  <span className="text-xs text-slate-400">
                    #{entry.number ?? "—"} · merged {formatRelativeTime(entry.at)}
                    {entry.queueTimeMs !== null
                      ? ` · spent ${formatDurationMs(entry.queueTimeMs)} in the queue`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "removed" ? (
          removed.length === 0 ? (
            <div className="mt-4">
              <LcEmpty title="Nothing has been removed from the queue">
                <p>
                  A pull request leaves the queue without merging only when it is closed without
                  merging — and that is always recorded here with its reason. Nothing is ever
                  silently dropped.
                </p>
              </LcEmpty>
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-white/5">
              {removed.map((entry) => (
                <li key={`${entry.number}-${entry.at}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  <span aria-hidden="true" className="text-slate-400">○</span>
                  <a
                    href={githubPrUrl(board.repoLabel, entry.number)}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 break-words font-semibold text-slate-100 underline-offset-2 hover:underline"
                  >
                    {entry.title || "Untitled pull request"}
                  </a>
                  <span className="text-xs text-slate-400">
                    #{entry.number ?? "—"} · removed {formatRelativeTime(entry.at)}
                    {entry.reason ? ` · ${entry.reason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </section>
  );
}
