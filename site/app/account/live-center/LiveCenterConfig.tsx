"use client";

// The Configuration tab: the merge rules in force for this
// repository, in plain language — how big a batch is and when it
// widens, which labels jump the queue, which checks are required,
// and the scheduled merge freezes with the next freeze and
// unfreeze. Read-only in this version: the rules are set by the
// workspace admin, and the page says so — there is no edit control
// here yet.

import type { LiveCenterBoardView } from "@/app/account/core/live-center";
import {
  describeFreezeWindow,
  formatFreezeInstant,
} from "@/app/account/core/live-center";
import { LC_PANEL } from "@/app/account/live-center/LiveCenterPrRows";

export function LiveCenterConfig({ board }: { board: LiveCenterBoardView }) {
  const rules = board.rules;
  const summary = board.summary;
  const widenPct =
    rules !== null ? Math.round(rules.widenBelowFailureRate * 1000) / 10 : 0;

  return (
    <section aria-label="Configuration" className="space-y-4">
      {summary.paused ? (
        <p className="rounded-xl border border-amber-300/25 bg-amber-400/[0.07] px-3 py-2 text-sm text-amber-100">
          This repository&rsquo;s queue is paused. Nothing merges until the workspace
          admin resumes it — a pause is stronger than any schedule below.
        </p>
      ) : null}
      {summary.frozen && !summary.paused ? (
        <p className="rounded-xl border border-sky-300/25 bg-sky-400/[0.07] px-3 py-2 text-sm text-sky-100">
          A merge freeze is in force right now. No batches are planned while it
          lasts; merges resume{" "}
          {summary.frozenUntil
            ? `at ${formatFreezeInstant(summary.frozenUntil)}`
            : "when the window ends"}
          .
        </p>
      ) : null}

      {rules === null ? (
        <div className={LC_PANEL}>
          <h2 className="font-semibold text-slate-100">Merge rules in force</h2>
          <p className="mt-1 text-sm text-slate-400">
            The board did not report this repository&rsquo;s merge rules, so there is
            nothing honest to show here yet. The queue itself is unaffected — this
            page fills in as soon as the board reports the rules.
          </p>
        </div>
      ) : (
        <>
          <div className={LC_PANEL}>
            <h2 className="font-semibold text-slate-100">Merge rules in force</h2>
            <dl className="mt-2 space-y-2 text-sm">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-slate-400">Batch size</dt>
                <dd className="text-slate-200">
                  Up to {rules.batchSize} pull request{rules.batchSize === 1 ? "" : "s"}{" "}
                  are checked together as one combined tree.
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-slate-400">Widening</dt>
                <dd className="text-slate-200">
                  When the recent failure rate stays below {widenPct}%, batches may
                  widen to {rules.widenTo} pull requests.
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-slate-400">Priority labels</dt>
                <dd className="text-slate-200">
                  {rules.priorityLabels.length > 0 ? (
                    <>
                      Pull requests labelled{" "}
                      <span className="font-medium text-slate-100">
                        {rules.priorityLabels.join(", ")}
                      </span>{" "}
                      are planned ahead of the rest of the queue. Every other pull
                      request keeps its queue order.
                    </>
                  ) : (
                    "None — pull requests are planned strictly in queue order."
                  )}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-slate-400">Required checks</dt>
                <dd className="text-slate-200">
                  {rules.requiredChecks !== null && rules.requiredChecks.length > 0 ? (
                    <>
                      A pull request can only count as ready when{" "}
                      <span className="font-medium text-slate-100">
                        {rules.requiredChecks.join(", ")}
                      </span>{" "}
                      has reported green on its newest commit.
                    </>
                  ) : (
                    "Read from the branch protection on GitHub — the board takes the required set from there."
                  )}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-slate-400">Rules version</dt>
                <dd className="text-slate-200">
                  Version {rules.version} — the version rises every time the
                  workspace admin changes these rules.
                </dd>
              </div>
            </dl>
          </div>

          <div className={LC_PANEL}>
            <h2 className="font-semibold text-slate-100">Scheduled merge freezes</h2>
            {rules.freezeWindows.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">
                No freezes are scheduled. Merges run whenever the queue is ready.
              </p>
            ) : (
              <>
                <ul className="mt-2 divide-y divide-white/5">
                  {rules.freezeWindows.map((window, index) => (
                    <li key={index} className="py-2.5 text-sm">
                      <p className="font-medium text-slate-200">
                        {describeFreezeWindow(window)}
                      </p>
                      <p className="mt-0.5 text-slate-400">
                        While a freeze is in force, the planner makes no merge-bound
                        batches for this repository.
                      </p>
                    </li>
                  ))}
                </ul>
                {summary.frozen && summary.frozenUntil ? (
                  <p className="mt-2 text-sm text-sky-100">
                    In force now — merges resume at{" "}
                    {formatFreezeInstant(summary.frozenUntil)}.
                  </p>
                ) : summary.nextFreezeAt ? (
                  <p className="mt-2 text-sm text-slate-300">
                    Next freeze starts {formatFreezeInstant(summary.nextFreezeAt)}.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </>
      )}

      <div className={LC_PANEL}>
        <h2 className="font-semibold text-slate-100">Who sets these rules</h2>
        <p className="mt-1 text-sm text-slate-400">
          In this version the merge rules are set by your workspace admin, and this
          page shows what is in force. Changing them from this page is a later
          addition — until then, ask your admin to make the change and it will
          appear here on the next refresh.
        </p>
      </div>
    </section>
  );
}
