"use client";

// "The Queue" — animated merge-queue card for the Process Solution hero.
//
// Motion grammar (borrowed from the category reference, built in
// SolveLang's own tokens): queue -> group -> fail -> bisect -> isolate
// -> merge green. Hard contracts from SHARED-SPEC (Nov 10 2026):
//   * transform + opacity are the only animated properties;
//   * fixed card dimensions at every breakpoint (zero layout shift);
//   * IntersectionObserver + document.hidden pause the loop;
//   * prefers-reduced-motion renders a still end-state tableau;
//   * animated internals are aria-hidden behind a figure label and a
//     visually-hidden sequence description.

import { useEffect, useRef, useState } from "react";
import {
  BATCH_CHIP,
  BATCH_LABEL,
  BEAT_BANNERS,
  BISECT_FLASH_WINDOWS,
  BREAKER_ID,
  CHECKING_CHIP,
  FAILED_CHIP,
  MERGED_CHIP,
  PASSED_CHIP,
  QUEUE_CARDS,
  QUEUED_CHIP,
  RETURNED_CHIP,
  SEQUENCE_DESCRIPTION,
  phaseAt,
  type QueueBeatId,
  type QueueVariant,
} from "./queue-animation";
import styles from "./QueueAnimation.module.css";

interface ViewState {
  beat: QueueBeatId | "still";
  beatIndex: number;
  progress: number;
  secondSplit: boolean;
  variant: QueueVariant;
  still: boolean;
}

const STILL_VIEW: ViewState = {
  beat: "still",
  beatIndex: 99,
  progress: 1,
  secondSplit: true,
  variant: "desktop",
  still: true,
};

const BEAT_ORDER: readonly QueueBeatId[] = [
  "queue",
  "batch",
  "break",
  "bisect",
  "isolate",
  "merge",
  "hold",
];

const AUTHOR_DOTS = ["bg-blue-500", "bg-indigo-500", "bg-teal-500", "bg-sky-500"];

/** Card row geometry inside the batch frame (px). */
const CARD_H = 44;
const CARD_GAP = 8;
const FRAME_PAD_TOP = 14;
const ROW = CARD_H + CARD_GAP;
/** How far healthy cards travel toward the `main` rail at merge. */
const MERGE_DROP: Record<QueueVariant, number> = { desktop: 122, mobile: 112 };

const BREAKER_INDEX = QUEUE_CARDS.findIndex((card) => card.id === BREAKER_ID);

type ChipKind = "queued" | "batch" | "checking" | "failed" | "passed" | "returned" | "merged";

const CHIP_TEXT: Record<ChipKind, string> = {
  queued: QUEUED_CHIP,
  batch: BATCH_CHIP,
  checking: CHECKING_CHIP,
  failed: FAILED_CHIP,
  passed: PASSED_CHIP,
  returned: RETURNED_CHIP,
  merged: MERGED_CHIP,
};

const CHIP_CLASSES: Record<ChipKind, string> = {
  queued: "bg-panel-alt text-muted",
  batch: "bg-accent-soft text-accent",
  checking: "bg-panel-alt text-muted",
  failed: "bg-danger-soft text-danger",
  passed: "bg-success-soft text-success",
  returned: "border border-danger bg-panel text-danger",
  merged: "bg-success text-ink",
};

function inWindow(progress: number, window: readonly [number, number]): boolean {
  return progress >= window[0] && progress <= window[1];
}

function pastWindow(progress: number, window: readonly [number, number]): boolean {
  return progress > window[1];
}

/** Has this healthy card's green flash begun/finished at this view? */
function flashState(index: number, view: ViewState): "off" | "flashing" | "done" {
  if (view.still) return "done";
  if (view.beat !== "bisect") {
    return view.beatIndex > BEAT_ORDER.indexOf("bisect") ? "done" : "off";
  }
  const [first, second] = BISECT_FLASH_WINDOWS;
  if (index >= 2) {
    if (inWindow(view.progress, first)) return "flashing";
    return pastWindow(view.progress, first) ? "done" : "off";
  }
  if (index === 0) {
    if (inWindow(view.progress, second)) return "flashing";
    return pastWindow(view.progress, second) ? "done" : "off";
  }
  return "off";
}

function chipFor(index: number, breaker: boolean, view: ViewState): ChipKind {
  if (view.still) return breaker ? "returned" : "passed";
  switch (view.beat) {
    case "queue":
      return "queued";
    case "batch":
      return "batch";
    case "break":
      return breaker ? "failed" : "checking";
    case "bisect": {
      if (breaker) return "failed";
      return flashState(index, view) === "off" ? "checking" : "passed";
    }
    case "isolate":
      return breaker ? "returned" : "passed";
    case "merge":
    case "hold":
      return breaker ? "returned" : "merged";
    default:
      return "queued";
  }
}

interface CardPose {
  transform: string;
  opacity: number;
  delayMs: number;
}

function cardPose(index: number, breaker: boolean, view: ViewState): CardPose {
  let x = 0;
  let y = 0;
  let scale = 1;
  let opacity = 1;
  let delayMs = 0;

  if (view.still) {
    if (breaker) {
      x = 30;
      scale = 0.98;
      opacity = 0.92;
    }
    return { transform: `translate(${x}px, ${y}px) scale(${scale})`, opacity, delayMs };
  }

  switch (view.beat) {
    case "queue": {
      const entered = view.progress >= index * 0.14;
      x = entered ? 0 : -18;
      opacity = entered ? 1 : 0;
      delayMs = index * 60;
      break;
    }
    case "batch":
    case "break":
      break;
    case "bisect": {
      y += index < 2 ? -4 : 4;
      if (view.secondSplit) y += index % 2 === 0 ? -3 : 3;
      if (breaker) {
        x = 6;
      }
      break;
    }
    case "isolate": {
      if (breaker) {
        x = 34;
        scale = 0.98;
        opacity = 0.9;
      } else if (index > BREAKER_INDEX) {
        y = -ROW;
      }
      break;
    }
    case "merge":
    case "hold": {
      if (breaker) {
        x = 34;
        scale = 0.98;
        opacity = 0.9;
      } else {
        y = (index > BREAKER_INDEX ? -ROW : 0) + MERGE_DROP[view.variant];
        scale = 0.95;
        opacity = view.beat === "hold" || view.progress >= 0.5 ? 0 : 1;
      }
      break;
    }
    default:
      break;
  }
  return { transform: `translate(${x}px, ${y}px) scale(${scale})`, opacity, delayMs };
}

function frameLayerOpacity(layer: "blue" | "rose" | "emerald", view: ViewState): number {
  if (view.still) return layer === "emerald" ? 1 : 0;
  switch (view.beat) {
    case "batch":
      return layer === "blue" ? 1 : 0;
    case "break":
      return layer === "rose" ? 1 : 0;
    case "bisect":
      return layer === "rose" ? 1 : 0;
    case "isolate":
      return layer === "blue" ? 1 : 0;
    case "merge":
    case "hold":
      return layer === "emerald" ? 1 : 0;
    default:
      return 0;
  }
}

/** Fade the whole stage out at the end of hold and back in on queue. */
function loopFade(view: ViewState): number {
  if (view.still) return 1;
  if (view.beat === "hold") {
    return view.progress <= 0.7 ? 1 : 1 - (view.progress - 0.7) / 0.3;
  }
  if (view.beat === "queue") {
    return Math.min(1, 0.25 + view.progress * 2);
  }
  return 1;
}

export default function QueueAnimation() {
  const rootRef = useRef<HTMLElement | null>(null);
  const [view, setView] = useState<ViewState>(STILL_VIEW);
  const [resetting, setResetting] = useState(false);
  const viewKeyRef = useRef("");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileMq = window.matchMedia("(max-width: 639px)");
    let raf = 0;
    let running = false;
    let visible = true;
    let last = 0;
    let elapsed = 0;
    let lastCycle = 0;

    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const tick = (now: number) => {
      if (!running) return;
      if (last) elapsed += now - last;
      last = now;
      const variant: QueueVariant = mobileMq.matches ? "mobile" : "desktop";
      const phase = phaseAt(elapsed, variant);
      const cycle = Math.floor(elapsed / phase.totalMs);
      if (cycle !== lastCycle) {
        lastCycle = cycle;
        setResetting(true);
        requestAnimationFrame(() => {
          window.setTimeout(() => setResetting(false), 40);
        });
      }
      const key = `${phase.beat}|${variant}|${phase.secondSplit}|${Math.round(phase.progress * 50)}`;
      if (key !== viewKeyRef.current) {
        viewKeyRef.current = key;
        setView({
          beat: phase.beat,
          beatIndex: phase.beatIndex,
          progress: phase.progress,
          secondSplit: phase.secondSplit,
          variant,
          still: false,
        });
      }
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(tick);
    };

    const sync = () => {
      if (reduceMq.matches) {
        stop();
        viewKeyRef.current = "still";
        setView(STILL_VIEW);
        return;
      }
      if (visible && !document.hidden) start();
      else stop();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        sync();
      },
      { threshold: 0.2 },
    );
    observer.observe(root);
    document.addEventListener("visibilitychange", sync);
    reduceMq.addEventListener("change", sync);
    mobileMq.addEventListener("change", sync);
    sync();
    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reduceMq.removeEventListener("change", sync);
      mobileMq.removeEventListener("change", sync);
    };
  }, []);

  const fade = loopFade(view);
  const showFrameLabel = view.still || view.beatIndex >= BEAT_ORDER.indexOf("batch");
  const showRailChecks = (i: number) =>
    view.still ||
    view.beat === "hold" ||
    (view.beat === "merge" && view.progress >= 0.3 + i * 0.18);
  const railDone = view.still || view.beat === "merge" || view.beat === "hold";

  return (
    <figure
      ref={rootRef}
      role="img"
      aria-label={SEQUENCE_DESCRIPTION}
      className="relative flex h-[448px] flex-col overflow-hidden rounded-3xl border border-line bg-panel shadow-sm sm:h-[468px]"
    >
      <p className="sr-only">{SEQUENCE_DESCRIPTION}</p>
      <div aria-hidden="true" className={`flex min-h-0 flex-1 flex-col ${resetting ? styles.resetting : ""}`}>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="ml-2 font-mono text-xs font-semibold text-body">merge-queue</span>
          <span className="ml-auto font-mono text-[11px] text-muted">combined-tree verification</span>
        </div>

        <div className="relative h-11 shrink-0" style={{ opacity: fade }}>
          {BEAT_ORDER.map((beat) => {
            const active = view.still ? beat === "hold" : view.beat === beat;
            const tone =
              beat === "break"
                ? "text-danger"
                : beat === "merge" || beat === "hold"
                  ? "text-success"
                  : "text-body";
            const dot =
              beat === "break" ? "bg-danger" : beat === "merge" || beat === "hold" ? "bg-success" : "bg-accent-solid";
            return (
              <div
                key={beat}
                className={`absolute inset-0 flex items-center gap-2 px-4 ${styles.anim} ${styles.durFast}`}
                style={{ opacity: active ? 1 : 0, transform: `translateY(${active ? 0 : 4}px)` }}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                <span className={`text-sm font-semibold ${tone}`}>{BEAT_BANNERS[beat]}</span>
              </div>
            );
          })}
        </div>

        <div className="relative min-h-0 flex-1 px-3 pb-3" style={{ opacity: fade }}>
          <div className="absolute inset-x-3 bottom-[60px] top-0">
            <div
              className={`absolute inset-0 rounded-2xl border-2 border-accent ${styles.anim} ${styles.durMed}`}
              style={{ opacity: frameLayerOpacity("blue", view) }}
            />
            <div
              className={`absolute inset-0 rounded-2xl border-2 border-danger ${styles.anim} ${styles.durMed}`}
              style={{ opacity: frameLayerOpacity("rose", view) }}
            />
            <div
              className={`absolute inset-0 rounded-2xl border-2 border-success ${styles.anim} ${styles.durMed}`}
              style={{ opacity: frameLayerOpacity("emerald", view) }}
            />
            <div
              className={`absolute inset-0 overflow-hidden rounded-2xl ${styles.anim} ${styles.durMed}`}
              style={{ opacity: !view.still && view.beat === "batch" ? 1 : 0 }}
            >
              <div
                className={`absolute inset-y-0 w-2/5 bg-gradient-to-r from-transparent via-blue-400/20 to-transparent ${view.beat === "batch" ? styles.shimmer : ""}`}
              />
            </div>
            <div
              className={`absolute -top-2.5 left-3 z-10 rounded-full border border-line bg-panel px-2.5 py-0.5 text-[11px] font-semibold text-body shadow-sm ${styles.anim} ${styles.durMed}`}
              style={{
                opacity: showFrameLabel ? 1 : 0,
                transform: `translateY(${showFrameLabel ? 0 : 4}px)`,
              }}
            >
              {BATCH_LABEL}
            </div>

            <div
              className="absolute left-3 right-3 z-[5] h-px bg-line-strong"
              style={{
                top: FRAME_PAD_TOP + 2 * ROW - CARD_GAP / 2,
                opacity: !view.still && view.beat === "bisect" ? 1 : 0,
              }}
            />
            <div
              className="absolute left-3 right-3 z-[5] h-px bg-line-strong"
              style={{
                top: FRAME_PAD_TOP + ROW - CARD_GAP / 2,
                opacity: !view.still && view.beat === "bisect" && view.secondSplit ? 1 : 0,
              }}
            />
            <div
              className="absolute left-3 right-3 z-[5] h-px bg-line-strong"
              style={{
                top: FRAME_PAD_TOP + 3 * ROW - CARD_GAP / 2,
                opacity: !view.still && view.beat === "bisect" && view.secondSplit ? 1 : 0,
              }}
            />
            <div
              className="absolute left-3 right-3 z-[5] h-0.5 bg-danger"
              style={{
                top: FRAME_PAD_TOP + ROW + 2,
                opacity: !view.still && view.beat === "break" ? 1 : 0,
              }}
            />

            <div className="absolute inset-0 flex flex-col gap-2 p-2.5" style={{ paddingTop: FRAME_PAD_TOP }}>
              {QUEUE_CARDS.map((card, index) => {
                const pose = cardPose(index, card.breaker, view);
                const chip = chipFor(index, card.breaker, view);
                const flash = card.breaker ? "off" : flashState(index, view);
                const greenOn = flash === "flashing" || flash === "done";
                const redOn =
                  card.breaker && (view.still || view.beat === "break" || view.beat === "bisect" || view.beatIndex > BEAT_ORDER.indexOf("bisect"));
                const border = card.breaker
                  ? redOn
                    ? "border-danger"
                    : "border-line"
                  : greenOn
                    ? "border-success"
                    : "border-line";
                const badgeOn =
                  card.breaker &&
                  (view.still || view.beat === "isolate" || view.beat === "merge" || view.beat === "hold");
                return (
                  <div
                    key={card.id}
                    className={`relative shrink-0 ${styles.anim} ${styles.durSlow}`}
                    style={{
                      height: CARD_H,
                      transform: pose.transform,
                      opacity: pose.opacity,
                      transitionDelay: `${pose.delayMs}ms`,
                      zIndex: card.breaker ? 6 : 4,
                    }}
                  >
                    <div className={`relative flex h-full items-center gap-2.5 overflow-hidden rounded-xl border bg-panel px-3 shadow-sm ${border}`}>
                      <div
                        className={`pointer-events-none absolute inset-0 bg-danger-soft ${styles.anim} ${styles.durFast}`}
                        style={{ opacity: redOn ? 1 : 0 }}
                      />
                      <div
                        className={`pointer-events-none absolute inset-0 bg-success-soft ${styles.anim} ${styles.durFast}`}
                        style={{ opacity: !card.breaker && greenOn ? 1 : 0 }}
                      />
                      <span className={`relative h-2.5 w-2.5 shrink-0 rounded-full ${AUTHOR_DOTS[index]}`} />
                      <span className="relative truncate font-mono text-[13px] font-medium text-body">{card.title}</span>
                      <span
                        className={`relative ml-auto font-bold text-success ${styles.anim} ${styles.durFast}`}
                        style={{
                          opacity: !card.breaker && greenOn ? 1 : 0,
                          transform: `scale(${!card.breaker && greenOn ? 1 : 0.5})`,
                        }}
                      >
                        ✓
                      </span>
                      <span className={`relative shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP_CLASSES[chip]}`}>
                        {CHIP_TEXT[chip]}
                      </span>
                    </div>
                    <span
                      className={`absolute -left-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-ink shadow ${styles.anim} ${styles.durFast}`}
                      style={{
                        opacity: badgeOn ? 1 : 0,
                        transform: `scale(${badgeOn ? 1 : 0.5})`,
                      }}
                    >
                      ✕
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="absolute inset-x-3 bottom-3 flex h-12 items-center gap-3 rounded-2xl bg-canvas px-4 text-ink">
            <span className="font-mono text-xs font-semibold text-body">main</span>
            <span className="flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`flex h-5 w-5 items-center justify-center rounded-full bg-success-soft text-[11px] font-bold text-success ${styles.anim} ${styles.durFast}`}
                  style={{
                    opacity: showRailChecks(i) ? 1 : 0,
                    transform: `scale(${showRailChecks(i) ? 1 : 0.5})`,
                  }}
                >
                  ✓
                </span>
              ))}
            </span>
            <span className={`ml-auto font-mono text-[11px] ${railDone ? "text-success" : "text-muted"}`}>
              {railDone ? "stayed green" : "protected"}
            </span>
          </div>
        </div>
      </div>
    </figure>
  );
}
