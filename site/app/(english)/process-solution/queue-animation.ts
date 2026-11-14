// "The Queue" — story engine for the Process Solution hero animation.
//
// Pure data and timing math only: no DOM, no timers, no React. The
// component (QueueAnimation.tsx) samples this timeline once per
// animation frame and renders every beat with transform/opacity
// transitions only. Copy law (owner brief, Nov 10 2026): outcome-level
// product truth only — generic PR titles, no governance internals, no
// thresholds, no pricing logic, no real repo or customer.

export type QueueBeatId =
  | "queue"
  | "batch"
  | "break"
  | "bisect"
  | "isolate"
  | "merge"
  | "hold";

export type QueueVariant = "desktop" | "mobile";

export interface QueueCardSpec {
  id: string;
  title: string;
  breaker: boolean;
}

/** The four generic pull requests, in queue order. */
export const QUEUE_CARDS: readonly QueueCardSpec[] = [
  { id: "auth-retry", title: "feat/auth-retry", breaker: false },
  { id: "cache-ttl", title: "fix/cache-ttl", breaker: true },
  { id: "deps-bump", title: "chore/deps-bump", breaker: false },
  { id: "export-csv", title: "feat/export-csv", breaker: false },
];

export const BREAKER_ID = "cache-ttl";

export function breakerCard(): QueueCardSpec {
  return QUEUE_CARDS.find((card) => card.breaker) as QueueCardSpec;
}

export function healthyCards(): readonly QueueCardSpec[] {
  return QUEUE_CARDS.filter((card) => !card.breaker);
}

export const QUEUED_CHIP = "queued";
export const BATCH_LABEL = "Combined tree — testing together";
export const BATCH_CHIP = "in batch";
export const CHECKING_CHIP = "checking";
export const FAILED_CHIP = "failed";
export const PASSED_CHIP = "passed";
export const RETURNED_CHIP = "returned";
export const MERGED_CHIP = "merged";

export const QUEUE_BANNER = "Four pull requests, one queue.";
export const BATCH_BANNER = "One combined tree, one check run.";
export const BREAK_BANNER = "Combined check failed.";
export const BISECT_BANNER = "Bisecting the batch to find the break.";
export const ISOLATE_BANNER = "Breaker isolated — returned to its author.";
export const MERGE_BANNER = "Main stayed green.";

export const BEAT_BANNERS: Readonly<Record<QueueBeatId, string>> = {
  queue: QUEUE_BANNER,
  batch: BATCH_BANNER,
  break: BREAK_BANNER,
  bisect: BISECT_BANNER,
  isolate: ISOLATE_BANNER,
  merge: MERGE_BANNER,
  hold: MERGE_BANNER,
};

/** Visually-hidden description of the sequence (accessibility contract). */
export const SEQUENCE_DESCRIPTION =
  "Animation: four pull requests are tested together as one combined tree. " +
  "When the combined check fails, the batch is bisected, the breaking change " +
  "is isolated and returned to its author, and the remaining pull requests " +
  "merge while main stays green.";

export interface QueueBeat {
  id: QueueBeatId;
  startMs: number;
  endMs: number;
}

export interface QueueTimeline {
  variant: QueueVariant;
  totalMs: number;
  /** How long the end state (hold beat) rests before the loop fades. */
  holdMs: number;
  beats: readonly QueueBeat[];
  /**
   * Fraction of the bisect beat at which the second split happens, or
   * null when the variant performs a single split (mobile calm loop).
   */
  secondSplitAt: number | null;
}

function buildTimeline(
  variant: QueueVariant,
  durations: readonly (readonly [QueueBeatId, number])[],
  secondSplitAt: number | null,
): QueueTimeline {
  let cursor = 0;
  const beats: QueueBeat[] = durations.map(([id, duration]) => {
    const beat: QueueBeat = { id, startMs: cursor, endMs: cursor + duration };
    cursor += duration;
    return beat;
  });
  const hold = beats[beats.length - 1];
  return {
    variant,
    totalMs: cursor,
    holdMs: hold.endMs - hold.startMs,
    beats,
    secondSplitAt,
  };
}

/** Desktop loop: 12.0s total, 1.6s end hold, two bisect splits. */
export const DESKTOP_TIMELINE: QueueTimeline = buildTimeline(
  "desktop",
  [
    ["queue", 1800],
    ["batch", 1800],
    ["break", 1200],
    ["bisect", 2400],
    ["isolate", 1800],
    ["merge", 1400],
    ["hold", 1600],
  ],
  0.45,
);

/** Mobile calm loop: 9.2s total, 1.6s end hold, single bisect split. */
export const MOBILE_TIMELINE: QueueTimeline = buildTimeline(
  "mobile",
  [
    ["queue", 1300],
    ["batch", 1400],
    ["break", 1000],
    ["bisect", 1700],
    ["isolate", 1400],
    ["merge", 800],
    ["hold", 1600],
  ],
  null,
);

export function timelineFor(variant: QueueVariant): QueueTimeline {
  return variant === "mobile" ? MOBILE_TIMELINE : DESKTOP_TIMELINE;
}

export interface QueuePhase {
  beat: QueueBeatId;
  beatIndex: number;
  /** 0..1 progress inside the current beat. */
  progress: number;
  banner: string;
  /** True once the second bisect split has happened (desktop only). */
  secondSplit: boolean;
  /** Position inside the loop, wrapped to [0, totalMs). */
  cycleMs: number;
  totalMs: number;
}

/** Sample the loop at an elapsed time. Negative and overflow times wrap. */
export function phaseAt(elapsedMs: number, variant: QueueVariant): QueuePhase {
  const timeline = timelineFor(variant);
  const total = timeline.totalMs;
  const t = ((elapsedMs % total) + total) % total;
  let beatIndex = timeline.beats.length - 1;
  for (let i = 0; i < timeline.beats.length; i += 1) {
    if (t < timeline.beats[i].endMs) {
      beatIndex = i;
      break;
    }
  }
  const beat = timeline.beats[beatIndex];
  const span = beat.endMs - beat.startMs;
  const progress = span > 0 ? (t - beat.startMs) / span : 1;
  return {
    beat: beat.id,
    beatIndex,
    progress,
    banner: BEAT_BANNERS[beat.id],
    secondSplit:
      beat.id === "bisect" &&
      timeline.secondSplitAt !== null &&
      progress >= timeline.secondSplitAt,
    cycleMs: t,
    totalMs: total,
  };
}

/**
 * Bisect green-flash windows, as fractions of the bisect beat: the first
 * flash follows the first split, the second follows the second split
 * (desktop). On mobile only the first window applies.
 */
export const BISECT_FLASH_WINDOWS: readonly (readonly [number, number])[] = [
  [0.15, 0.5],
  [0.55, 0.9],
];
