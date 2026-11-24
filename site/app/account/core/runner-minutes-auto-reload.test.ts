import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNNER_MINUTES_AUTO_RELOAD_BODY,
  RUNNER_MINUTES_AUTO_RELOAD_PATH,
  RUNNER_MINUTES_AUTO_RELOAD_TITLE,
  RUNNER_MINUTES_SAVE_CARD_PATH,
  runnerMinutesAutoReloadLastLine,
  runnerMinutesAutoReloadMinutesLabel,
  runnerMinutesAutoReloadNeedsPaymentMethod,
  runnerMinutesAutoReloadPackLabel,
  runnerMinutesAutoReloadPoolLabel,
  runnerMinutesAutoReloadPools,
  runnerMinutesSavedCardLabel,
  runnerMinutesSavedPaymentMethod,
  type RunnerMinutesAutoReloadView,
} from "./runner-minutes-auto-reload";

// The auto-reload contract is shared by the account home's
// Auto-reload card and (for the body sentence) the buy page. These
// tests pin the semantics both surfaces render by, so the two can
// never drift onto different endpoints, different copy, or a
// different reading of the service's refusal.

test("the card title is the approved word, verbatim", () => {
  assert.equal(RUNNER_MINUTES_AUTO_RELOAD_TITLE, "Auto-reload");
});

test("the card body is the approved sentence, verbatim", () => {
  assert.equal(
    RUNNER_MINUTES_AUTO_RELOAD_BODY,
    "Keep your workflows running without interruption. Enable auto-reload and your minutes top up automatically at 85% usage — before a running job ever has to wait on balance.",
  );
});

test("the settings are read and set through the one auto-reload route", () => {
  assert.equal(RUNNER_MINUTES_AUTO_RELOAD_PATH, "/customer/runner-minutes/auto-reload");
});

test("the save-card route is the existing Agent Access page", () => {
  assert.equal(RUNNER_MINUTES_SAVE_CARD_PATH, "/account/agent-access/");
});

test("pool labels name the three pools plainly", () => {
  assert.equal(runnerMinutesAutoReloadPoolLabel("standard"), "Standard");
  assert.equal(runnerMinutesAutoReloadPoolLabel("high-power"), "High-Power");
  assert.equal(runnerMinutesAutoReloadPoolLabel("premium"), "Premium");
});

test("a record-shaped view reads each pool's settings", () => {
  const view: RunnerMinutesAutoReloadView = {
    pools: {
      standard: {
        enabled: true,
        packKey: "standard-5000",
        packs: [{ key: "standard-5000", minutes: 5000, totalDollars: 20 }],
        baselineSeconds: 300000,
        balanceSeconds: 60000,
        lastReloadAt: "2026-11-20T10:00:00.000Z",
        lastStatus: "succeeded",
      },
    },
    savedPaymentMethod: { brand: "Visa", last4: "4242" },
  };
  const pools = runnerMinutesAutoReloadPools(view);
  assert.equal(pools.length, 3);
  assert.deepEqual(pools.map((entry) => entry.pool), ["standard", "high-power", "premium"]);
  const standard = pools[0];
  assert.equal(standard.enabled, true);
  assert.equal(standard.packKey, "standard-5000");
  assert.equal(standard.packs.length, 1);
  assert.equal(standard.baselineSeconds, 300000);
  assert.equal(standard.balanceSeconds, 60000);
  assert.equal(standard.lastStatus, "succeeded");
  // A pool the service did not mention reads as off, never on.
  assert.equal(pools[1].enabled, false);
  assert.equal(pools[1].packKey, null);
  assert.deepEqual(runnerMinutesSavedPaymentMethod(view), { brand: "Visa", last4: "4242" });
});

test("a list-shaped view reads each pool's settings too", () => {
  const view: RunnerMinutesAutoReloadView = {
    pools: [
      { pool: "premium", enabled: true, packKey: "premium-5000" },
      { pool: "standard", enabled: false },
    ],
    savedPaymentMethod: null,
  };
  const pools = runnerMinutesAutoReloadPools(view);
  assert.equal(pools[2].pool, "premium");
  assert.equal(pools[2].enabled, true);
  assert.equal(pools[2].packKey, "premium-5000");
  assert.equal(pools[0].enabled, false);
  assert.equal(runnerMinutesSavedPaymentMethod(view), null);
});

test("a missing or malformed saved payment method reads as none", () => {
  assert.equal(runnerMinutesSavedPaymentMethod({}), null);
  assert.equal(runnerMinutesSavedPaymentMethod({ savedPaymentMethod: null }), null);
});

test("the saved card label shows brand and last4", () => {
  assert.equal(runnerMinutesSavedCardLabel({ brand: "Visa", last4: "4242" }), "Visa ···· 4242");
});

test("only the payment_method_required code routes to the save-card flow", () => {
  assert.equal(runnerMinutesAutoReloadNeedsPaymentMethod({ code: "payment_method_required" }), true);
  assert.equal(runnerMinutesAutoReloadNeedsPaymentMethod({ code: "something_else" }), false);
  assert.equal(runnerMinutesAutoReloadNeedsPaymentMethod(new Error("payment_method_required")), false);
  assert.equal(runnerMinutesAutoReloadNeedsPaymentMethod(null), false);
  assert.equal(runnerMinutesAutoReloadNeedsPaymentMethod("payment_method_required"), false);
});

test("pack labels prefer the service label, then minutes and price, then the key", () => {
  assert.equal(runnerMinutesAutoReloadPackLabel({ key: "a", label: "Named pack" }), "Named pack");
  assert.equal(runnerMinutesAutoReloadPackLabel({ key: "b", minutes: 5000, totalDollars: 20 }), "5,000 minutes · $20");
  assert.equal(runnerMinutesAutoReloadPackLabel({ key: "c", minutes: 25000 }), "25,000 minutes");
  assert.equal(runnerMinutesAutoReloadPackLabel({ key: "d" }), "d");
});

test("seconds render as whole minutes, and absence renders as nothing", () => {
  assert.equal(runnerMinutesAutoReloadMinutesLabel(300000), "5,000 minutes");
  assert.equal(runnerMinutesAutoReloadMinutesLabel(null), null);
});

test("a failed reload is stated as failed, in plain words", () => {
  const line = runnerMinutesAutoReloadLastLine({
    pool: "standard",
    enabled: true,
    packKey: "standard-5000",
    packs: [],
    baselineSeconds: null,
    balanceSeconds: null,
    lastReloadAt: "2026-11-20T10:00:00.000Z",
    lastStatus: "failed",
  });
  assert.ok(line?.startsWith("The last auto-reload failed"));
  assert.ok(line?.includes("not topped up"));
});

test("a succeeded reload and an unreported one read plainly", () => {
  const base = {
    pool: "standard" as const,
    enabled: true,
    packKey: null,
    packs: [],
    baselineSeconds: null,
    balanceSeconds: null,
  };
  assert.ok(
    runnerMinutesAutoReloadLastLine({ ...base, lastReloadAt: "2026-11-20T10:00:00.000Z", lastStatus: "succeeded" })
      ?.startsWith("Last auto-reload succeeded"),
  );
  assert.equal(runnerMinutesAutoReloadLastLine({ ...base, lastReloadAt: null, lastStatus: null }), null);
});
