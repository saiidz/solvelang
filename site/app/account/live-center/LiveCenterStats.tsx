"use client";

// The Statistics tab: queue and check history as small cards, each
// with today's live or latest recorded value, a 14-day sparkline
// once history exists, and a plain-language note saying what the
// number means. Until history accumulates, the cards say so —
// recording started with queue history, and nothing is back-filled.

import type { LiveCenterBoardView, LiveCenterHistoryDay } from "@/app/account/core/live-center";
import { formatDurationMs } from "@/app/account/core/live-center";
import { LC_PANEL } from "@/app/account/live-center/LiveCenterPrRows";

function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const nums = values.filter((value): value is number => value !== null);
  if (nums.length < 2) {
    return (
      <p className="mt-2 text-xs text-slate-500">
        No history yet — recording starts with the queue-history addition; the first points
        appear as pull requests enter, merge, and leave the queue.
      </p>
    );
  }
  const width = 120;
  const height = 28;
  const max = Math.max(...nums, 1);
  const min = Math.min(...nums, 0);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const points: string[] = [];
  values.forEach((value, index) => {
    if (value === null) return;
    const x = (index * stepX).toFixed(1);
    const y = (height - 3 - ((value - min) / span) * (height - 6)).toFixed(1);
    points.push(`${x},${y}`);
  });
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-2 h-7 w-full text-sky-300"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

type StatCard = {
  title: string;
  value: string;
  series: (number | null)[];
  seriesLabel: string;
  note: string;
};

function StatGroup({ title, cards }: { title: string; cards: StatCard[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.title} className={LC_PANEL}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{card.title}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-50">{card.value}</p>
            <Sparkline values={card.series} label={`${card.title}, last 14 days`} />
            <p className="mt-2 text-xs leading-relaxed text-slate-400">{card.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const pct = (value: number | null) => (value === null ? "—" : `${value}%`);
const num = (value: number | null) => (value === null ? "—" : String(value));

export function LiveCenterStats({ board }: { board: LiveCenterBoardView }) {
  const daily: LiveCenterHistoryDay[] = board.history.daily;
  const latest = daily.length > 0 ? daily[daily.length - 1] : null;
  const period = board.history.period;
  const failureRate = (day: LiveCenterHistoryDay | null) => {
    if (!day || day.checksPassed === null || day.checksFailed === null) return null;
    const total = day.checksPassed + day.checksFailed;
    return total > 0 ? Math.round((day.checksFailed / total) * 1000) / 10 : null;
  };

  const queueCards: StatCard[] = [
    {
      title: "Entered the queue",
      value: num(latest?.entered ?? null),
      series: daily.map((day) => day.entered),
      seriesLabel: "Pull requests entering the queue per day",
      note: `Pull requests that entered the queue today. ${period.entered} entered in the last ${period.days || 14} days.`,
    },
    {
      title: "Merged",
      value: num(latest?.merged ?? null),
      series: daily.map((day) => day.merged),
      seriesLabel: "Pull requests merged per day",
      note: `Pull requests that landed today. ${period.merged} merged in the last ${period.days || 14} days.`,
    },
    {
      title: "Merged rate",
      value: pct(latest?.mergedRatePct ?? null),
      series: daily.map((day) => day.mergedRatePct),
      seriesLabel: "Share of entered pull requests that merged, per day",
      note: "Of the pull requests that entered the queue today, the share that merged today. Young queues swing wildly — read it over the whole period, not one day.",
    },
    {
      title: "Queue time",
      value: latest?.queueTimeMedianMs != null ? formatDurationMs(latest.queueTimeMedianMs) : "—",
      series: daily.map((day) => day.queueTimeMedianMs),
      seriesLabel: "Median time from entering the queue to merging, per day",
      note: "The middle value of how long today's merged pull requests spent in the queue, from entering to landing.",
    },
  ];

  const checkCards: StatCard[] = [
    {
      title: "Test failure rate",
      value: pct(failureRate(latest)),
      series: daily.map(failureRate),
      seriesLabel: "Share of finished checks that failed, per day",
      note: "Of the checks that finished on the latest recorded day, the share that failed. One failing pull request can fail many checks — the Pull requests tab shows which.",
    },
    {
      title: "Test runtime",
      value: latest?.runtimeMedianMs != null ? formatDurationMs(latest.runtimeMedianMs) : "—",
      series: daily.map((day) => day.runtimeMedianMs),
      seriesLabel: "Median check runtime per day",
      note: "The middle value of how long a finished check took on the latest recorded day.",
    },
    {
      title: "Waiting for a runner",
      value: String(board.runners.waitingCount),
      series: daily.map(() => null),
      seriesLabel: "Jobs waiting for a runner",
      note: "Live right now, not history: jobs GitHub has queued that no runner has picked up yet. The Runners tab lists them by name.",
    },
    {
      title: "Batch splits",
      value: "—",
      series: daily.map(() => null),
      seriesLabel: "Batch splits per day",
      note: "When a batch's combined check fails, the batch splits to find the pull request that broke it. Splits are recorded once batches merge automatically — the queue currently only proposes batches, so there is nothing to record yet.",
    },
  ];

  return (
    <section aria-label="Statistics" className="space-y-6">
      <p className="max-w-3xl text-sm text-slate-400">
        How the queue and its checks have been doing over the last {period.days || 14} days. Every
        card shows its latest recorded value and the shape of the days behind it — where a card
        says there is no history yet, that is the truth: recording began when queue history
        switched on, and nothing is back-filled or estimated.
      </p>
      <StatGroup title="Merge queue" cards={queueCards} />
      <StatGroup title="Checks" cards={checkCards} />
    </section>
  );
}
