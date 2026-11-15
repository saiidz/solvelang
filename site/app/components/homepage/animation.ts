// Pure animation math and pacing constants for the homepage animation
// system (approved preview, Nov 12 2026). No DOM access: every helper
// takes plain numbers so the public QA suite can pin the behavior
// directly. The DOM side lives in LandingAnimation.tsx.
//
// Discipline (shared with QueueAnimation on /process-solution/):
// transform + opacity are the only animated properties (plus the
// color/shadow emphasis of the Studio walkthrough, exactly as in the
// approved preview); zero layout shift; sequences pause while the tab
// is hidden; prefers-reduced-motion renders the finished state.

/** Studio walkthrough pacing: each beat holds this long. */
export const STUDIO_DWELL_MS = 1600;
/** Beat allowed for the Studio panel to settle before beat one. */
export const STUDIO_START_MS = 900;
/** Base reveal stagger step (ms per --i). */
export const REVEAL_STAGGER_MS = 95;
/** Hero line stagger step (ms per --i). */
export const HERO_STAGGER_MS = 140;
/** Evidence card highlight stagger step (ms per --i). */
export const EVIDENCE_STAGGER_MS = 180;
/** Sweep fallback line: a reveal target whose top crosses this
 *  fraction of the viewport height is revealed even if its
 *  IntersectionObserver entry lags. */
export const REVEAL_SWEEP_LINE = 0.85;
/** Solve Context has four stages/chips that warm in quarters. */
export const CONTEXT_PARTS = 4;
/** Studio panel flow beats: node, connector, node, connector, node. */
export const FLOW_BEATS = 5;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Sticky-pin progress for the Solve Context wrap: 0 while the wrap's
 * top is at or below the viewport top, 1 once the wrap's bottom
 * reaches the viewport bottom (the pinned section's last frame).
 */
export function pinProgress(wrapTop: number, wrapHeight: number, viewportHeight: number): number {
  const travel = wrapHeight - viewportHeight;
  if (travel <= 0) return wrapTop < 0 ? 1 : 0;
  return clamp01(-wrapTop / travel);
}

/**
 * Normal-flow traversal progress (small/short screens, no pin): 0
 * when the section's top reaches the viewport bottom, 1 when its
 * bottom reaches the viewport top.
 */
export function traversalProgress(rectTop: number, rectHeight: number, viewportHeight: number): number {
  const span = viewportHeight + rectHeight;
  if (span <= 0) return 0;
  return clamp01((viewportHeight - rectTop) / span);
}

export interface Warmth {
  /** Opacity between the resting 0.35 and the arrived 1. */
  opacity: number;
  /** True once this part's quarter of the progress is complete. */
  arrived: boolean;
}

/** Continuous warming for one Solve Context stage/chip: each part
 *  warms across its own quarter of the overall progress. */
export function warmth(progress: number, index: number, parts: number = CONTEXT_PARTS): Warmth {
  const local = clamp01(progress * parts - index);
  return { opacity: 0.35 + 0.65 * local, arrived: local >= 1 };
}

/** Sweep-fallback test for one reveal target. */
export function revealDue(rectTop: number, viewportHeight: number): boolean {
  return rectTop < viewportHeight * REVEAL_SWEEP_LINE;
}

/** Hero panel parallax offset (px), transform-only, capped. */
export function heroParallax(scrollY: number): number {
  return Math.min(Math.max(scrollY, 0) * 0.05, 18);
}

export interface FlowPaint {
  /** Node index currently lit, -1 before the first beat. */
  activeNode: number;
  /** Node indexes fully passed. */
  doneNodes: number[];
  /** Connector index currently lit, -1 while a node beat shows. */
  activeConnector: number;
  /** Connector indexes fully passed. */
  doneConnectors: number[];
  /** Scenario-path step currently lit (mirrors the active node). */
  activePathStep: number;
}

/**
 * Studio panel flow paint state for one beat. Beats alternate node /
 * connector: 0 node0, 1 connector0, 2 node1, 3 connector1, 4 node2.
 */
export function flowPaint(beat: number): FlowPaint {
  const activeNode = Math.floor(beat / 2);
  const doneNodes: number[] = [];
  for (let i = 0; i < activeNode; i += 1) doneNodes.push(i);
  const activeConnector = beat % 2 === 1 ? (beat - 1) / 2 : -1;
  const doneConnectors: number[] = [];
  for (let j = 0; j * 2 + 1 < beat; j += 1) doneConnectors.push(j);
  return { activeNode, doneNodes, activeConnector, doneConnectors, activePathStep: activeNode };
}
