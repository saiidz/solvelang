// AG-UI pilot core: turns the board snapshot carried by the AG-UI
// stream's STATE_SNAPSHOT event into exactly what the pilot page
// renders, and classifies the failures the stream can end with.
// Framework-free on purpose — the React component is a thin shell
// over this file, and this file is what the tests exercise.
//
// The snapshot is the pilot board payload unchanged, so it goes
// through the SAME normalizer the real Live Center board uses
// (normalizeLiveCenterBoard): the pilot renders the board the
// server computed, never a parallel interpretation of it.

import { LIVE_CENTER_STAGE_LABELS, normalizeLiveCenterBoard } from "./live-center";

export type AgUiPilotPhase =
  | "connecting"
  | "live"
  | "disabled"
  | "unauthenticated"
  | "stream-error"
  | "failed";

export type AgUiPilotView = {
  repoLabel: string;
  generatedAt: string;
  paused: boolean;
  frozen: boolean;
  counts: {
    openPrs: number;
    inQueue: number;
    checking: number;
    failing: number;
    ready: number;
    waitingOnOwner: number;
    runnersOnline: number;
    runnersTotal: number | null;
    runnersBusy: number;
  };
  queue: { position: number; number: number | null; title: string; stageLabel: string }[];
  queueTotal: number;
  runners: { name: string; status: string; busy: boolean }[];
};

// How much of the queue the pilot lists: the first page, matching
// the board's own page size. The total rides along so the page can
// say "first 25 of N" instead of silently truncating.
export const AG_UI_PILOT_QUEUE_LIMIT = 25;

export function agUiPilotViewFromSnapshot(snapshot: unknown): AgUiPilotView {
  const board = normalizeLiveCenterBoard(snapshot);
  const queue = board.queue.slice(0, AG_UI_PILOT_QUEUE_LIMIT).map((entry) => ({
    position: entry.position,
    number: entry.number,
    title: entry.title,
    stageLabel: LIVE_CENTER_STAGE_LABELS[entry.stage] ?? entry.stage,
  }));
  return {
    repoLabel: board.repoLabel,
    generatedAt: board.generatedAt,
    paused: board.summary.paused,
    frozen: board.summary.frozen,
    counts: {
      openPrs: board.stats.openPrs,
      inQueue: board.stats.inQueuePrs,
      checking: board.stats.checkingPrs,
      failing: board.stats.failingPrs,
      ready: board.stats.readyPrs,
      waitingOnOwner: board.stats.waitingOnOwner,
      runnersOnline: board.fleet.online,
      runnersTotal: board.fleet.total,
      runnersBusy: board.fleet.busy,
    },
    queue,
    queueTotal: board.queue.length,
    runners: board.fleet.runners.map((runner) => ({
      name: runner.name,
      status: runner.status,
      busy: runner.busy,
    })),
  };
}

// The pilot endpoint's failure shapes, mapped to the page's phases:
// a 401 is the session gate (the same answer every /customer/* route
// gives), the two 503 codes both mean "this stream is not available
// on this server" (the pilot flag is off, or the Live Center behind
// it is not configured), and anything else is a plain failure.
export function classifyAgUiFailure(status: number, code: string | undefined): AgUiPilotPhase {
  if (status === 401) return "unauthenticated";
  if (code === "ag_ui_pilot_disabled" || code === "mgov_not_configured") return "disabled";
  return "failed";
}
