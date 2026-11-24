// Trial Phase 2 — the web-claim activation surface (decision D3) and
// its claim-time signal collection (decision D4), built under the
// privacy assessment's conditions (trial-phase2-privacy-assessment-
// 2026-11-22.md SS7.4 and SS9).
//
// The runners service owns the claim decision:
//   GET  /customer/runner-minutes/trial-claim -> the caller's claim state
//   POST /customer/runner-minutes/trial-claim -> submit a claim
// This module is the site's half of that contract: the claim-screen
// copy (SS7.4, verbatim), the frozen signal set the claim page
// collects (C2), the bucketing the collector applies, and the
// collector itself.
//
// Collection discipline (C1/C15): the collector in this module runs
// ONLY from the claim action on the account home — nothing else on
// the site imports it. The signal set is the frozen, enumerated list
// from the signal-set inventory: user-agent, screen class (bucketed
// classes, never exact pixels), timezone, language, platform, a
// canvas-probe hash computed in the browser (the raw canvas output
// never leaves the device — only its hash is sent), and the WebGL
// renderer class. The signals travel once, with the claim request,
// and the service hashes them with HMAC-SHA-256 before any
// persistence (C3). If collection fails or is blocked, the claim is
// submitted without signals and the service holds it for human
// review — never a denial (C8).

export const TRIAL_CLAIM_PATH = "/customer/runner-minutes/trial-claim";

// The frozen device-signal field list (C2 — signal-set inventory,
// 2026-11-22). The claim handler reads exactly these fields; adding
// one is a privacy change requiring an assessment update first.
export const TRIAL_SIGNAL_FIELDS = Object.freeze([
  "userAgent",
  "screenClass",
  "timezone",
  "language",
  "platform",
  "canvasHash",
  "webglClass",
] as const);

export type TrialClaimSignals = {
  userAgent: string;
  screenClass: string;
  timezone: string;
  language: string;
  platform: string;
  canvasHash: string;
  webglClass: string;
};

// The claim state the service reports for the session's tenant
// (stateFor in the runners service): "pending_claim" while a grant
// waits for its claim, "held" while a flagged claim waits for a
// person, "active" once minutes are released, "not_required" for
// grants that predate claim activation and were never pended.
export type TrialClaimState = "pending_claim" | "held" | "active" | "not_required";

export type TrialClaimView = {
  claim: {
    state: TrialClaimState;
    claimState?: string;
    band?: string;
    releasedMinutes?: number;
    totalMinutes?: number;
    holdReason?: string | null;
    status?: string;
  } | null;
  mode?: string;
};

export type TrialClaimOutcome = {
  outcome?: string;
  reasonCode?: string | null;
};

// Which claim surface the account home renders, if any: the claim
// screen while a grant waits to be claimed, the held notice while a
// person reviews, and nothing otherwise (no grant, already active,
// or a grandfathered grant that never needed a claim).
export function trialClaimScreen(view: TrialClaimView | null | undefined): "claim" | "held" | null {
  if (!view || !view.claim) return null;
  if (view.claim.state === "pending_claim") return "claim";
  if (view.claim.state === "held") return "held";
  return null;
}

// ---------------------------------------------------------------------------
// SS7.4 claim-screen copy — verbatim from the privacy assessment.
// The heading, the explanation, the action label and the
// alternatives line are the transparency text C13 requires to be
// what the customer actually sees before the check runs.

export const TRIAL_CLAIM_HEADING = "Activate your 300 free Standard minutes";

export const TRIAL_CLAIM_BODY =
  "To keep the trial one-per-person, we run a quick device and network check when you activate. We store only a coded version of the check — never your raw device details — keep it for 12 months in a separate security store, and use it only to prevent trial abuse. If the check flags anything, a person reviews it (normally within 2 business days); nothing is finally refused automatically.";

export const TRIAL_CLAIM_ACTION_LABEL = "Activate trial";

export const TRIAL_CLAIM_ALTERNATIVES =
  "Prefer not to run the device check? You can activate immediately by purchasing any pack, or email hello@solve-lang.com and we will review your claim manually.";

export const TRIAL_CLAIM_MANUAL_REVIEW_LABEL = "Request a manual review instead";

// Shown when a claim is held for human review (C7/C8): a hold is a
// delay with a person at the end of it, never a refusal.
export const TRIAL_CLAIM_HELD_LINE =
  "Your trial claim is being reviewed by a person. Nothing is finally refused automatically — we will email you when the review is done, normally within 2 business days. You can activate immediately at any time by purchasing any pack.";

// ---------------------------------------------------------------------------
// Screen class (C2): bucketed screen characteristics — classes, not
// exact pixel values. Width and height are bucketed by common
// breakpoints, colour depth into three classes, and the pixel ratio
// into 1x / 2x / 3x+. The same device class produces the same string
// across minor resolution differences inside a bucket.

const SCREEN_EDGES = [640, 1024, 1440, 1920, 2560];

function screenBucket(value: number): number {
  let bucket = 0;
  while (bucket < SCREEN_EDGES.length && value >= SCREEN_EDGES[bucket]) bucket += 1;
  return bucket;
}

export function trialScreenClass(input: {
  width: number;
  height: number;
  colorDepth: number;
  devicePixelRatio: number;
}): string {
  const depthClass = input.colorDepth <= 8 ? 0 : input.colorDepth <= 24 ? 1 : 2;
  const ratioClass = input.devicePixelRatio < 1.5 ? 0 : input.devicePixelRatio < 2.5 ? 1 : 2;
  return `w${screenBucket(input.width)}-h${screenBucket(input.height)}-d${depthClass}-r${ratioClass}`;
}

// ---------------------------------------------------------------------------
// The collector. Browser-only; every probe is fail-soft — a blocked
// or unavailable probe yields an empty field, and a claim submitted
// with absent signals routes to human review on the service (C8),
// never to a denial.

async function canvasProbeHash(): Promise<string> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 24;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.textBaseline = "top";
    context.font = "14px Arial";
    context.fillStyle = "#f60";
    context.fillRect(2, 2, 60, 10);
    context.fillStyle = "#069";
    context.fillText("SolveLang trial claim", 4, 4);
    const data = canvas.toDataURL();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

function webglRendererClass(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "";
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return String(renderer || "").slice(0, 128);
  } catch {
    return "";
  }
}

// Collect exactly the frozen signal set, at the claim action only.
export async function collectTrialSignals(): Promise<TrialClaimSignals> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const scr = typeof screen !== "undefined" ? screen : undefined;
  let timezone = "";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    timezone = "";
  }
  return {
    userAgent: nav?.userAgent || "",
    screenClass: scr
      ? trialScreenClass({
          width: scr.width,
          height: scr.height,
          colorDepth: scr.colorDepth,
          devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
        })
      : "",
    timezone,
    language: nav ? (nav.languages && nav.languages.length > 0 ? nav.languages.join(",") : nav.language || "") : "",
    platform: nav?.platform || "",
    canvasHash: await canvasProbeHash(),
    webglClass: webglRendererClass(),
  };
}
