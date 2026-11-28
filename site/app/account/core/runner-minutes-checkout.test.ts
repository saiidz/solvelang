import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RUNNER_MINUTES_ALL_PACKS,
  RUNNER_MINUTES_CACHE_PACKS,
  RUNNER_MINUTES_FLOW_STEPS,
  RUNNER_MINUTES_HIGH_POWER_PACKS,
  RUNNER_MINUTES_PREMIUM_PACKS,
  RUNNER_MINUTES_LABELS,
  RUNNER_MINUTES_STANDARD_PACKS,
  RUNNER_MINUTES_TERMS,
  resolveRunnerMinutesPack,
} from "./runner-minutes-checkout";

test("standard packs match the service catalog totals", () => {
  assert.deepEqual(
    RUNNER_MINUTES_STANDARD_PACKS.map((p) => [p.key, p.minutes, p.totalDollars]),
    [
      ["standard-5000", 5_000, 20],
      ["standard-25000", 25_000, 100],
      ["standard-100000", 100_000, 400],
    ],
  );
});

test("high-power ladder totals strictly climb and anchors are the owner's rungs", () => {
  let previous = 0;
  for (const pack of RUNNER_MINUTES_HIGH_POWER_PACKS) {
    assert.ok(pack.totalDollars > previous, `${pack.key} must cost more than the previous rung`);
    previous = pack.totalDollars;
  }
  const anchors = RUNNER_MINUTES_HIGH_POWER_PACKS.filter((p) => p.anchor).map((p) => p.key);
  assert.deepEqual(anchors, ["high-power-1000", "high-power-2000", "high-power-10000"]);
  assert.equal(RUNNER_MINUTES_HIGH_POWER_PACKS[0].totalDollars, 80);
  assert.equal(RUNNER_MINUTES_HIGH_POWER_PACKS.at(-1)?.totalDollars, 400);
});

test("the cache bundle is 10 GB-months at the ratified $0.20 rate", () => {
  assert.equal(RUNNER_MINUTES_CACHE_PACKS.length, 1);
  assert.equal(RUNNER_MINUTES_CACHE_PACKS[0].gbMonths, 10);
  assert.equal(RUNNER_MINUTES_CACHE_PACKS[0].totalDollars, 2);
});

test("pack resolution defaults safely and honors real keys", () => {
  assert.equal(resolveRunnerMinutesPack(null).key, "standard-5000");
  assert.equal(resolveRunnerMinutesPack("bogus").key, "standard-5000");
  assert.equal(resolveRunnerMinutesPack("high-power-5000").totalDollars, 275);
  assert.equal(resolveRunnerMinutesPack("speed-lane-cache-10").pool, "cache");
  assert.equal(RUNNER_MINUTES_ALL_PACKS.length, 25);
});

test("the flow copy encodes confirm-before-spin-up", () => {
  assert.ok(RUNNER_MINUTES_FLOW_STEPS.some((s) => s.includes("Nothing spins up before you confirm")));
  assert.ok(RUNNER_MINUTES_FLOW_STEPS.some((s) => s.includes("recommend")));
});

test("labels and terms carry the product facts", () => {
  assert.match(RUNNER_MINUTES_LABELS.standard, /solvelang-runners-standard/);
  assert.match(RUNNER_MINUTES_LABELS.speedLane, /solvelang-runners-speed/);
  assert.ok(RUNNER_MINUTES_TERMS.some((t) => t.includes("twice the pack rate")));
  assert.ok(RUNNER_MINUTES_TERMS.some((t) => t.includes("12 months")));
});

test("premium packs match the service catalog: flat $0.50/min, owner-priced", () => {
  assert.deepEqual(
    RUNNER_MINUTES_PREMIUM_PACKS.map((p) => [p.key, p.minutes, p.totalDollars]),
    [
      ["premium-5000", 5_000, 2500],
      ["premium-10000", 10_000, 5000],
      ["premium-25000", 25_000, 12500],
      ["premium-30000", 30_000, 15000],
      ["premium-40000", 40_000, 20000],
      ["premium-50000", 50_000, 25000],
      ["premium-60000", 60_000, 30000],
      ["premium-70000", 70_000, 35000],
      ["premium-80000", 80_000, 40000],
      ["premium-90000", 90_000, 45000],
      ["premium-100000", 100_000, 50000],
    ],
  );
  for (const pack of RUNNER_MINUTES_PREMIUM_PACKS) {
    assert.equal(pack.pool, "premium");
    assert.equal(pack.anchor, true, `${pack.key} is an owner-set price`);
    assert.equal(pack.minutes === null ? null : pack.totalDollars / pack.minutes, 0.5, `${pack.key} is exactly $0.50/min`);
  }
  assert.equal(resolveRunnerMinutesPack("premium-25000").totalDollars, 12500);
  assert.equal(resolveRunnerMinutesPack("premium-10000").totalDollars, 5000);
  assert.equal(resolveRunnerMinutesPack("premium-30000").totalDollars, 15000);
  assert.equal(resolveRunnerMinutesPack("premium-50000").totalDollars, 25000);
  assert.equal(resolveRunnerMinutesPack("premium-90000").totalDollars, 45000);
  assert.equal(RUNNER_MINUTES_PREMIUM_PACKS.length, 11);
  const premiumMinutes = RUNNER_MINUTES_PREMIUM_PACKS.map((p) => p.minutes ?? 0);
  assert.deepEqual(premiumMinutes, [...premiumMinutes].sort((a, b) => a - b), "premium packs climb by minutes");
  assert.equal(RUNNER_MINUTES_LABELS.premium, "runs-on: [self-hosted, solvelang-runners-premium]");
});

test("runner-minutes elements-checkout request carries the first-touch attribution (SEO P0)", () => {
  const checkout = readFileSync(new URL("../../account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout.tsx", import.meta.url), "utf8");
  assert.match(checkout, /import \{ firstTouchWire, readFirstTouch \} from "@\/app\/attribution\/first-touch";/);
  assert.match(checkout, /\.\.\.\(firstTouch \? \{ attribution: firstTouchWire\(firstTouch\) \} : \{\}\)/);
});
