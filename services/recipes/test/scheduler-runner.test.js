import assert from "node:assert/strict";
import test from "node:test";

import { createRegistry } from "../src/registry.js";
import { createRecipesRunner } from "../src/runner.js";
import { createScheduleRegistry, createScheduler, cadenceIntervalMs } from "../src/scheduler.js";

// QA pins for the scheduler firing decisions and the runner loop:
// due/not-due by cadence, pull_request dispatch gating, config read
// at the base SHA, skipped (not silent) runs for disabled recipes,
// the invalid-config note in record AND receipt, and audit emission
// on every run.

const PROBE = {
  id: "stage0-fixture-probe",
  title: "probe",
  triggerClasses: ["manual", "schedule", "pull_request"],
  identityClass: "scan",
  internal: true,
};

function fakeRunner({ configText, executeRecipe, audits }) {
  const registry = createRegistry([PROBE]);
  let tick = 0;
  return createRecipesRunner({
    registry,
    readConfigTextAtRef: async ({ path, ref }) => {
      assert.equal(path, ".github/solvelang-recipes.json");
      assert.equal(ref, "base-sha");
      return configText;
    },
    executeRecipe:
      executeRecipe ??
      (async () => ({
        conclusion: "success",
        findings: [{ label: "verified", text: "Probe observed the fixture.", evidence: true }],
      })),
    postAudit: async (record) => {
      audits.push(record);
      return { ok: true };
    },
    now: () => (tick += 100),
    createId: () => "run-test-1",
  });
}

const ENABLED = JSON.stringify({
  version: 1,
  recipes: { "stage0-fixture-probe": { enabled: true, cadence: "daily" } },
});

test("runner: enabled recipe executes, grades, meters and audits", async () => {
  const audits = [];
  const runner = fakeRunner({ configText: ENABLED, audits });
  const { record, receipt } = await runner.runRecipe({
    repo: "octo/widgets",
    recipeId: "stage0-fixture-probe",
    trigger: "manual",
    baseSha: "base-sha",
    installationId: 186232390,
  });
  assert.equal(record.conclusion, "success");
  assert.equal(record.auditOk, true);
  assert.equal(record.metering.executor, "scan");
  assert.equal(record.metering.durationMs, 100);
  assert.deepEqual(receipt.grading, { verified: 1, failed: 0, unverified: 0 });
  assert.equal(receipt.falseVerifiedLabel, false);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].id, "run-test-1");
});

test("runner: disabled or absent recipe records a SKIPPED run, never a silent success", async () => {
  const audits = [];
  const runner = fakeRunner({ configText: null, audits });
  const { record, receipt } = await runner.runRecipe({
    repo: "octo/widgets",
    recipeId: "stage0-fixture-probe",
    trigger: "schedule",
    baseSha: "base-sha",
  });
  assert.equal(record.conclusion, "skipped");
  assert.equal(receipt.grading.unverified, 1);
  assert.equal(receipt.grading.verified, 0);
  assert.equal(audits.length, 1);
});

test("runner: invalid config puts the visible note in record AND receipt and skips", async () => {
  const audits = [];
  const runner = fakeRunner({ configText: "{broken", audits });
  const { record, receipt } = await runner.runRecipe({
    repo: "octo/widgets",
    recipeId: "stage0-fixture-probe",
    trigger: "manual",
    baseSha: "base-sha",
  });
  assert.equal(record.conclusion, "skipped");
  assert.equal(record.notes.length, 1);
  assert.match(record.notes[0], /invalid/);
  assert.deepEqual(receipt.notes, record.notes);
  assert.equal(audits.length, 1);
});

test("runner: executor failure is an error record with no claimed evidence", async () => {
  const audits = [];
  const runner = fakeRunner({
    configText: ENABLED,
    audits,
    executeRecipe: async () => {
      throw new TypeError("boom with secret detail");
    },
  });
  const { record, receipt } = await runner.runRecipe({
    repo: "octo/widgets",
    recipeId: "stage0-fixture-probe",
    trigger: "manual",
    baseSha: "base-sha",
  });
  assert.equal(record.conclusion, "error");
  assert.equal(receipt.grading.verified, 0);
  assert.ok(!JSON.stringify(receipt).includes("secret detail"));
});

test("scheduler: fires only due cadence entries and records every firing", async () => {
  const registry = createRegistry([PROBE]);
  const scheduleRegistry = createScheduleRegistry();
  const t0 = 1_000_000;
  scheduleRegistry.registerRepo({
    repo: "octo/widgets",
    scheduled: [
      { definition: registry.get("stage0-fixture-probe"), entry: { enabled: true, cadence: "weekly" } },
    ],
    registeredAt: t0,
  });
  const fired = [];
  const scheduler = createScheduler({
    registry: scheduleRegistry,
    dispatch: async (args) => {
      fired.push(args);
      return { id: `run-${fired.length}`, ...args };
    },
  });
  assert.deepEqual(await scheduler.tick(t0 + cadenceIntervalMs("daily")), []);
  const first = await scheduler.tick(t0 + cadenceIntervalMs("weekly"));
  assert.equal(first.length, 1);
  assert.equal(first[0].trigger, "schedule");
  // Not due again until another week passes.
  assert.deepEqual(await scheduler.tick(t0 + cadenceIntervalMs("weekly") + 1_000), []);
  assert.equal((await scheduler.tick(t0 + 2 * cadenceIntervalMs("weekly"))).length, 1);
});

test("scheduler: re-registering a repo replaces its entries from the new config", async () => {
  const registry = createRegistry([PROBE]);
  const scheduleRegistry = createScheduleRegistry();
  scheduleRegistry.registerRepo({
    repo: "octo/widgets",
    scheduled: [
      { definition: registry.get("stage0-fixture-probe"), entry: { enabled: true, cadence: "daily" } },
    ],
    registeredAt: 0,
  });
  assert.equal(scheduleRegistry.list().length, 1);
  scheduleRegistry.registerRepo({ repo: "octo/widgets", scheduled: [], registeredAt: 0 });
  assert.equal(scheduleRegistry.list().length, 0);
});

test("scheduler: pull_request dispatch is gated on the recipe's trigger classes", async () => {
  const registry = createRegistry([PROBE]);
  const scheduleRegistry = createScheduleRegistry();
  const scheduler = createScheduler({
    registry: scheduleRegistry,
    dispatch: async (args) => ({ id: "run-pr", ...args }),
  });
  const ok = await scheduler.dispatchPullRequest({
    registry,
    repo: "octo/widgets",
    recipeId: "stage0-fixture-probe",
    prNumber: 3,
  });
  assert.equal(ok.fired, true);
  assert.equal(ok.record.trigger, "pull_request");
  // lint-autofix has no pull_request class.
  const refused = await scheduler.dispatchPullRequest({
    registry,
    repo: "octo/widgets",
    recipeId: "lint-autofix",
    prNumber: 3,
  });
  assert.deepEqual(refused, { fired: false, reason: "trigger_not_supported" });
  const unknown = await scheduler.dispatchPullRequest({
    registry,
    repo: "octo/widgets",
    recipeId: "nope",
    prNumber: 3,
  });
  assert.deepEqual(unknown, { fired: false, reason: "unknown_recipe" });
});
