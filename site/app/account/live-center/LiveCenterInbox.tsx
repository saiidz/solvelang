"use client";

// The Inbox tab: everything waiting on a person, grouped by what
// kind of wait it is. Every group explains itself in plain words —
// what the state means and what happens next — and every row's
// button opens the pull request on GitHub in a new tab, which is
// where the actual fixing, resolving, or approving happens.

import { useState } from "react";
import type { LiveCenterBoardView } from "@/app/account/core/live-center";
import { formatRelativeTime, paginateList } from "@/app/account/core/live-center";
import {
  LC_PANEL,
  LcEmpty,
  LcPager,
  githubPrUrl,
  githubRunUrl,
} from "@/app/account/live-center/LiveCenterPrRows";

export function LiveCenterInbox({ board }: { board: LiveCenterBoardView }) {
  const [pages, setPages] = useState<Record<string, number>>({});
  const totalItems = board.inboxGroups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <section aria-label="Inbox — waiting on you" className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">
        Everything that is waiting on a person, grouped by the kind of wait. Every button opens
        the pull request on GitHub in a new tab — that is where you mark a draft ready, resolve a
        conflict, or approve a deployment. Nothing here needs an answer inside SolveLang.
      </p>

      {board.inboxGroups.length === 0 ? (
        <LcEmpty title="Nothing is waiting on you">
          <p>
            No pull request needs a person right now — no drafts waiting to be marked ready, no
            failing checks, no conflicts, no reviews outstanding, no deployments to approve. When
            something does need a person, it lands here with the reason spelled out.
          </p>
        </LcEmpty>
      ) : (
        board.inboxGroups.map((group) => {
          const page = pages[group.key] ?? 1;
          const pageData = paginateList(group.items, page);
          return (
            <div key={group.key} className={LC_PANEL}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-ink">{group.label}</h3>
                <span className="inline-block rounded-full bg-panel-alt px-2 py-0.5 text-xs font-semibold text-body">
                  {group.items.length}
                </span>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-muted">{group.description}</p>
              <ul className="mt-2 divide-y divide-line">
                {pageData.items.map((item, index) => {
                  const href =
                    group.key === "deployment"
                      ? githubRunUrl(board.repoLabel, item.runId)
                      : githubPrUrl(board.repoLabel, item.number);
                  const age = item.updatedAt ? formatRelativeTime(item.updatedAt) : "";
                  return (
                    <li
                      key={`${item.number ?? item.runId ?? index}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3"
                    >
                      <div className="min-w-0 flex-1 basis-64">
                        <p className="break-words font-medium text-ink">
                          {item.title || item.blocker}
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted">
                          {item.number !== null ? <span>#{item.number}</span> : null}
                          {item.title ? <span>{item.blocker}</span> : null}
                          {item.total > 0 ? (
                            <span>
                              · {item.passed}/{item.total} checks passed
                            </span>
                          ) : null}
                          {age ? <span>· updated {age}</span> : null}
                        </p>
                      </div>
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block shrink-0 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm text-body transition hover:bg-panel-alt"
                      >
                        {group.key === "deployment" ? "Open the run on GitHub" : "Open on GitHub"}
                      </a>
                    </li>
                  );
                })}
              </ul>
              <LcPager
                page={pageData.page}
                pages={pageData.pages}
                total={pageData.total}
                noun="items in this group"
                onPage={(next) => setPages((current) => ({ ...current, [group.key]: next }))}
              />
            </div>
          );
        })
      )}
      {totalItems > 0 ? (
        <p className="text-xs text-muted">
          {totalItems} item{totalItems === 1 ? "" : "s"} waiting across {board.inboxGroups.length}{" "}
          group{board.inboxGroups.length === 1 ? "" : "s"}.
        </p>
      ) : null}
    </section>
  );
}
