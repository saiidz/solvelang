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
      <p className="max-w-3xl text-sm text-muted">
        Your runner minutes: the time your own machines spend running checks. Spot minutes are
        spent first because they cost less; on-demand minutes cover the work that cannot wait for
        a spot machine. One credit is one minute on a standard machine — bigger machines draw
        proportionally more.
      </p>

      {minutes.recommendation ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning bg-warning-soft p-4 sm:p-5">
          <p className="min-w-0 flex-1 basis-64 text-sm text-warning">{minutes.recommendation.text}</p>
          <a href={minutes.buyPath} className={LC_BTN}>
            {minutes.recommendation.actionLabel} — opens the checkout page
          </a>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {minutes.balances.map((balance) => (
          <div key={balance.kind || balance.label} className={LC_PANEL}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{balance.label}</p>
            <p className="mt-1 text-3xl font-semibold text-ink">
              {minutesText(balance.minutesLeft)}
              <span className="ml-2 text-sm font-normal text-muted">left</span>
            </p>
            {balance.packMinutes !== null ? (
              <p className="mt-1 text-sm text-muted">
                of {balance.packMinutes.toLocaleString("en-US")} minutes in the current pack
              </p>
            ) : null}
            {balance.rateText ? <p className="mt-1 text-sm text-muted">{balance.rateText}</p> : null}
            {balance.lowBalance ? (
              <p className="mt-2 rounded-lg border border-warning bg-warning-soft px-2.5 py-1.5 text-sm text-warning">
                Running low — top up soon so queued checks are not held back.
              </p>
            ) : null}
            {balance.note ? <p className="mt-2 text-xs text-muted">{balance.note}</p> : null}
          </div>
        ))}
      </div>

      {minutes.lanes ? (
        <div className={LC_PANEL}>
          <h3 className="font-semibold text-ink">Where the minutes went — {minutes.lanes.windowLabel}</h3>
          {lanesTotal > 0 ? (
            <div
              aria-hidden="true"
              className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-panel-alt"
            >
              <span
                className="bg-success"
                style={{ width: `${(((minutes.lanes.spotMinutes ?? 0) / lanesTotal) * 100).toFixed(1)}%` }}
              />
              <span
                className="bg-accent"
                style={{ width: `${(((minutes.lanes.onDemandMinutes ?? 0) / lanesTotal) * 100).toFixed(1)}%` }}
              />
            </div>
          ) : null}
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-body">
            <span>
              <span aria-hidden="true" className="text-success">●</span> Spot:{" "}
              {minutesText(minutes.lanes.spotMinutes)} — cheaper machines that can be reclaimed
            </span>
            <span>
              <span aria-hidden="true" className="text-accent">●</span> On-demand:{" "}
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
          <h3 className="font-semibold text-ink">Usage by repository</h3>
          <ul className="mt-2 divide-y divide-line">
            {minutes.byRepository.map((row) => (
              <li key={row.repo} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5 text-sm">
                <span className="min-w-0 flex-1 basis-48 break-words font-medium text-body">{row.repo}</span>
                <span className="text-body">{minutesText(row.minutes)}</span>
                <span className="text-muted">
                  {row.jobs === null ? "" : `${row.jobs} job${row.jobs === 1 ? "" : "s"}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {minutes.recentJobs.length > 0 ? (
        <div className={LC_PANEL}>
          <h3 className="font-semibold text-ink">Recent jobs</h3>
          <ul className="mt-2 divide-y divide-line">
            {minutes.recentJobs.map((job, index) => (
              <li key={`${job.name}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <span className="min-w-0 flex-1 basis-48 break-words font-medium text-body">{job.name}</span>
                <span className="text-muted">{job.repo}</span>
                <span className="text-muted">{job.machine}</span>
                <span
                  className="inline-block rounded-full border border-line bg-panel px-2 py-0.5 text-[11px] text-body"
                  title={
                    job.lane === "spot"
                      ? "Ran on a spot machine — cheaper, and can be reclaimed by the provider."
                      : "Ran on an on-demand machine — guaranteed capacity."
                  }
                >
                  {job.lane === "spot" ? "Spot" : job.lane === "on_demand" ? "On-demand" : job.lane}
                </span>
                <span className="text-body">{job.durationText}</span>
                <span className="text-muted">
                  {job.creditsDrawn === null ? "" : `${job.creditsDrawn} credits`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {minutes.cache ? (
        <div className={LC_PANEL}>
          <h3 className="font-semibold text-ink">Build cache</h3>
          <p className="mt-1 text-sm text-body">
            {minutes.cache.gbStored === null ? "—" : `${minutes.cache.gbStored} GB`} stored
            {minutes.cache.monthCostText ? ` · about ${minutes.cache.monthCostText} this month` : ""}
          </p>
          {minutes.cache.note ? (
            <p className="mt-1 text-sm text-muted">{minutes.cache.note}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted">
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
