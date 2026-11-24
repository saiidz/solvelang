import assert from "node:assert/strict";
import test from "node:test";
import {
  TRIAL_CLAIM_ACTION_LABEL,
  TRIAL_CLAIM_ALTERNATIVES,
  TRIAL_CLAIM_BODY,
  TRIAL_CLAIM_HEADING,
  TRIAL_CLAIM_PATH,
  TRIAL_SIGNAL_FIELDS,
  trialClaimScreen,
  trialScreenClass,
  type TrialClaimState,
  type TrialClaimView,
} from "./trial-claim";

// Trial Phase 2 claim-surface pins: the claim screen is the one
// place device signals are collected (C1), over exactly the frozen
// field list (C2), behind the SS7.4 transparency copy (C13).

test("the claim surface talks to the runners trial-claim route only", () => {
  assert.equal(TRIAL_CLAIM_PATH, "/customer/runner-minutes/trial-claim");
});

test("the signal field list is the frozen C2 set, in order", () => {
  assert.deepEqual([...TRIAL_SIGNAL_FIELDS], [
    "userAgent",
    "screenClass",
    "timezone",
    "language",
    "platform",
    "canvasHash",
    "webglClass",
  ]);
});

test("the claim-screen copy is the SS7.4 text verbatim", () => {
  assert.equal(TRIAL_CLAIM_HEADING, "Activate your 300 free Standard minutes");
  assert.equal(
    TRIAL_CLAIM_BODY,
    "To keep the trial one-per-person, we run a quick device and network check when you activate. We store only a coded version of the check — never your raw device details — keep it for 12 months in a separate security store, and use it only to prevent trial abuse. If the check flags anything, a person reviews it (normally within 2 business days); nothing is finally refused automatically.",
  );
  assert.equal(TRIAL_CLAIM_ACTION_LABEL, "Activate trial");
  assert.equal(
    TRIAL_CLAIM_ALTERNATIVES,
    "Prefer not to run the device check? You can activate immediately by purchasing any pack, or email hello@solve-lang.com and we will review your claim manually.",
  );
});

test("the screen mapping shows the claim screen only for pending and held claims", () => {
  const view = (state: TrialClaimState): TrialClaimView => ({ claim: { state } });
  assert.equal(trialClaimScreen(null), null);
  assert.equal(trialClaimScreen(undefined), null);
  assert.equal(trialClaimScreen({ claim: null }), null);
  assert.equal(trialClaimScreen(view("pending_claim")), "claim");
  assert.equal(trialClaimScreen(view("held")), "held");
  assert.equal(trialClaimScreen(view("active")), null);
  assert.equal(trialClaimScreen(view("not_required")), null);
});

test("screen class buckets dimensions instead of reporting exact pixels", () => {
  const base = { width: 1512, height: 982, colorDepth: 24, devicePixelRatio: 2 };
  assert.equal(trialScreenClass(base), trialScreenClass({ ...base, width: 1500, height: 900 }));
  assert.notEqual(trialScreenClass(base), trialScreenClass({ ...base, width: 800 }));
  assert.notEqual(trialScreenClass(base), trialScreenClass({ ...base, devicePixelRatio: 1 }));
  assert.match(trialScreenClass(base), /^w\d+-h\d+-d\d+-r\d+$/);
  assert.ok(!trialScreenClass(base).includes("1512"), "no exact pixel value leaks into the class");
});
