import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNNER_MINUTES_ALL_PACKS,
  RUNNER_MINUTES_CACHE_PACKS,
  RUNNER_MINUTES_FLOW_STEPS,
  RUNNER_MINUTES_HIGH_POWER_PACKS,
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
  assert.equal(RUNNER_MINUTES_ALL_PACKS.length, 14);
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
