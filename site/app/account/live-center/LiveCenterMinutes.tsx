"use client";

// The Minutes tab: runner-minute balances and usage. The numbers
// live in the separate runners service; until it is connected, this
// tab shows the honest not-configured state and explains what will
// live here. It never invents a balance.

import type { LiveCenterMinutesView } from "@/app/account/core/live-center";
import { LC_BTN, LC_PANEL, LcEmpty } from "@/app/account/live-center/LiveCenterPrRows";

function minutesText(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("en-US")} min`;
}

export function LiveCenterMinutes({ minutes }: { minutes: LiveCenterMinutesView }) {
  if (!minutes.configured) {
    return (
      <section aria-label="Runner minutes" className="space-y-4">
        <LcEmpty title="Runner minutes will live here — balances, usage by repository, and top-ups">
          <p>
            This tab is wired to the runner-minutes service, which tracks the minutes your
            self-hosted runners spend on checks. That service is not connected yet, so there are
            no balances to show — and this page will not guess any.
          </p>
          <p className="mt-2">
            When it connects, you will see: how many minutes are left in each pack, which
            repositories used them, the jobs they were spent on, and a recommendation when a
            balance runs low. Minutes are bought in packs on SolveLang&rsquo;s own checkout page —
            buying works today; the balances appear here once the service is connected.
          </p>
          <p className="mt-3">
            <a href={minutes.buyPath} className={LC_BTN}>
              Buy a minutes pack — opens the checkout page
            </a>
          </p>
        </LcEmpty>
      </section>
    );
  }

  const lanesTotal =
    minutes.lanes !== null
      ? (minutes.lanes.spotMinutes ?? 0) + (minutes.lanes.onDemandMinutes ?? 0)
      : 0;

  return (
    <section aria-label="Runner minutes" className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-400">
        Your runner minutes: the time your own machines spend running checks. Spot minutes are
        spent first because they cost less; on-demand minutes cover the work that cannot wait for
        a spot machine. One credit is one minute on a standard machine — bigger machines draw
        proportionally more.
      </p>

      {minutes.recommendation ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.07] p-4 sm:p-5">
          <p className="min-w-0 flex-1 basis-64 text-sm text-amber-100">{minutes.recommendation.text}</p>
          <a href={minutes.buyPath} className={LC_BTN}>
            {minutes.recommendation.actionLabel} — opens the checkout page
          </a>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {minutes.balances.map((balance) => (
          <div key={balance.kind || balance.label} className={LC_PANEL}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{balance.label}</p>
            <p className="mt-1 text-3xl font-semibold text-slate-50">
              {minutesText(balance.minutesLeft)}
              <span className="ml-2 text-sm font-normal text-slate-400">left</span>
            </p>
            {balance.packMinutes !== null ? (
              <p className="mt-1 text-sm text-slate-400">
                of {balance.packMinutes.toLocaleString("en-US")} minutes in the current pack
              </p>
            ) : null}
            {balance.rateText ? <p className="mt-1 text-sm text-slate-400">{balance.rateText}</p> : null}
            {balance.lowBalance ? (
              <p className="mt-2 rounded-lg border border-amber-300/25 bg-amber-400/10 px-2.5 py-1.5 text-sm text-amber-200">
                Running low — top up soon so queued checks are not held back.
              </p>
            ) : null}
            {balance.note ? <p className="mt-2 text-xs text-slate-500">{balance.note}</p> : null}
          </div>
        ))}
      </div>

      {minutes.lanes ? (
        <div className={LC_PANEL}>
          <h3 className="font-semibold text-slate-100">Where the minutes went — {minutes.lanes.windowLabel}</h3>
          {lanesTotal > 0 ? (
            <div
              aria-hidden="true"
              className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-white/10"
            >
              <span
                className="bg-emerald-400"
                style={{ width: `${(((minutes.lanes.spotMinutes ?? 0) / lanesTotal) * 100).toFixed(1)}%` }}
              />
              <span
                className="bg-sky-400"
                style={{ width: `${(((minutes.lanes.onDemandMinutes ?? 0) / lanesTotal) * 100).toFixed(1)}%` }}
              />
            </div>
          ) : null}
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
            <span>
              <span aria-hidden="true" className="text-emerald-400">●</span> Spot:{" "}
              {minutesText(minutes.lanes.spotMinutes)} — cheaper machines that can be reclaimed
            </span>
            <span>
              <span aria-hidden="true" className="text-sky-400">●</span> On-demand:{" "}
              {minutesText(minutes.lanes.onDemandMinutes)} — guaranteed machines, used when spot
              capacity is not there
            </span>
            {minutes.lanes.creditsDrawn !== null ? (
              <span>Credits drawn in this window: {minutes.lanes.creditsDrawn.toLocaleString("en-US")}</span>
            ) : null}
          </p>
        </div>
      ) : null}

      {minutes.byRepository.length > 0 ? (
        <div className={LC_PANEL}>
          <h3 className="font-semibold text-slate-100">Usage by repository</h3>
          <ul className="mt-2 divide-y divide-white/5">
            {minutes.byRepository.map((row) => (
              <li key={row.repo} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5 text-sm">
                <span className="min-w-0 flex-1 basis-48 break-words font-medium text-slate-200">{row.repo}</span>
                <span className="text-slate-300">{minutesText(row.minutes)}</span>
                <span className="text-slate-500">
                  {row.jobs === null ? "" : `${row.jobs} job${row.jobs === 1 ? "" : "s"}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {minutes.recentJobs.length > 0 ? (
        <div className={LC_PANEL}>
          <h3 className="font-semibold text-slate-100">Recent jobs</h3>
          <ul className="mt-2 divide-y divide-white/5">
            {minutes.recentJobs.map((job, index) => (
              <li key={`${job.name}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <span className="min-w-0 flex-1 basis-48 break-words font-medium text-slate-200">{job.name}</span>
                <span className="text-slate-400">{job.repo}</span>
                <span className="text-slate-400">{job.machine}</span>
                <span
                  className="inline-block rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300"
                  title={
                    job.lane === "spot"
                      ? "Ran on a spot machine — cheaper, and can be reclaimed by the provider."
                      : "Ran on an on-demand machine — guaranteed capacity."
                  }
                >
                  {job.lane === "spot" ? "Spot" : job.lane === "on_demand" ? "On-demand" : job.lane}
                </span>
                <span className="text-slate-300">{job.durationText}</span>
                <span className="text-slate-500">
                  {job.creditsDrawn === null ? "" : `${job.creditsDrawn} credits`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {minutes.cache ? (
        <div className={LC_PANEL}>
          <h3 className="font-semibold text-slate-100">Build cache</h3>
          <p className="mt-1 text-sm text-slate-300">
            {minutes.cache.gbStored === null ? "—" : `${minutes.cache.gbStored} GB`} stored
            {minutes.cache.monthCostText ? ` · about ${minutes.cache.monthCostText} this month` : ""}
          </p>
          {minutes.cache.note ? (
            <p className="mt-1 text-sm text-slate-400">{minutes.cache.note}</p>
          ) : null}
          <p className="mt-1 text-xs text-slate-500">
            The cache keeps downloaded dependencies on your runners so repeat jobs start faster.
            It is billed by stored size, separately from minutes.
          </p>
        </div>
      ) : null}

      <p>
        <a href={minutes.buyPath} className={LC_BTN}>
          Buy a minutes pack or top up — opens the checkout page
        </a>
      </p>
    </section>
  );
}
