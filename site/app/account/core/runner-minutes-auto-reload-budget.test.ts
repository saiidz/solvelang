import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNNER_MINUTES_AUTO_RELOAD_BUDGET_REACHED_LINE,
  runnerMinutesAutoReloadBudget,
  runnerMinutesAutoReloadBudgetCentsFromInput,
  runnerMinutesAutoReloadBudgetSpendLine,
  runnerMinutesAutoReloadLastLine,
  runnerMinutesAutoReloadMoneyLabel,
  type RunnerMinutesAutoReloadPoolSettings,
} from "./runner-minutes-auto-reload";

// The monthly budget cap (runners service extension, Nov 24,
// 2026): the Auto-reload card's budget row renders the service's
// { budgetCents, spentThisMonthCents, budgetReached } with the
// service's own reached rule, speaks dollars, and posts whole
// cents back. These tests pin the reading, the labels and the
// input parsing the row depends on.

test("the budget reached line is the approved sentence, verbatim", () => {
  assert.equal(
    RUNNER_MINUTES_AUTO_RELOAD_BUDGET_REACHED_LINE,
    "Monthly auto-reload budget reached — auto-reload resumes on the 1st.",
  );
});

test("a view with no budget fields reads as no cap, nothing spent, not reached", () => {
  assert.deepEqual(runnerMinutesAutoReloadBudget({}), {
    budgetCents: null,
    spentThisMonthCents: 0,
    budgetReached: false,
  });
});

test("the budget normalizer passes the service's numbers through", () => {
  assert.deepEqual(
    runnerMinutesAutoReloadBudget({ budgetCents: 5000, spentThisMonthCents: 2000, budgetReached: false }),
    { budgetCents: 5000, spentThisMonthCents: 2000, budgetReached: false },
  );
});

test("a 0 or negative cap from the wire reads as no cap", () => {
  assert.equal(runnerMinutesAutoReloadBudget({ budgetCents: 0 }).budgetCents, null);
  assert.equal(runnerMinutesAutoReloadBudget({ budgetCents: -50 }).budgetCents, null);
});

test("reached is derived with the service's rule: spend at or over the cap", () => {
  assert.equal(
    runnerMinutesAutoReloadBudget({ budgetCents: 2000, spentThisMonthCents: 2000 }).budgetReached,
    true,
  );
  assert.equal(
    runnerMinutesAutoReloadBudget({ budgetCents: 2000, spentThisMonthCents: 1999 }).budgetReached,
    false,
  );
  // No cap is never reached, whatever the spend.
  assert.equal(
    runnerMinutesAutoReloadBudget({ budgetCents: null, spentThisMonthCents: 999999 }).budgetReached,
    false,
  );
});

test("money labels speak dollars: whole dollars bare, otherwise two places", () => {
  assert.equal(runnerMinutesAutoReloadMoneyLabel(2000), "$20");
  assert.equal(runnerMinutesAutoReloadMoneyLabel(2050), "$20.50");
  assert.equal(runnerMinutesAutoReloadMoneyLabel(250000), "$2,500");
  assert.equal(runnerMinutesAutoReloadMoneyLabel(5), "$0.05");
  assert.equal(runnerMinutesAutoReloadMoneyLabel(0), "$0");
});

test("the spend line reads $X of $Y this month under a cap, and is null without one", () => {
  assert.equal(
    runnerMinutesAutoReloadBudgetSpendLine({ budgetCents: 5000, spentThisMonthCents: 2000, budgetReached: false }),
    "$20 of $50 this month",
  );
  assert.equal(
    runnerMinutesAutoReloadBudgetSpendLine({ budgetCents: null, spentThisMonthCents: 2000, budgetReached: false }),
    null,
  );
});

test("the budget input parses dollars to whole cents; an empty field clears the cap", () => {
  assert.deepEqual(runnerMinutesAutoReloadBudgetCentsFromInput(""), { ok: true, budgetCents: null });
  assert.deepEqual(runnerMinutesAutoReloadBudgetCentsFromInput("   "), { ok: true, budgetCents: null });
  assert.deepEqual(runnerMinutesAutoReloadBudgetCentsFromInput("50"), { ok: true, budgetCents: 5000 });
  assert.deepEqual(runnerMinutesAutoReloadBudgetCentsFromInput("50.25"), { ok: true, budgetCents: 5025 });
  assert.deepEqual(runnerMinutesAutoReloadBudgetCentsFromInput(" 2500 "), { ok: true, budgetCents: 250000 });
});

test("the budget input refuses zero, negatives, non-numbers and sub-cent amounts", () => {
  for (const bad of ["0", "-5", "abc", "0.001", "1,000"]) {
    assert.deepEqual(runnerMinutesAutoReloadBudgetCentsFromInput(bad), { ok: false }, `input ${bad}`);
  }
});

test("a pool whose last reload was budget-blocked says so in plain words", () => {
  const settings: RunnerMinutesAutoReloadPoolSettings = {
    pool: "standard",
    enabled: true,
    packKey: "standard-5000",
    packs: [],
    baselineSeconds: 5000 * 60,
    balanceSeconds: 100 * 60,
    lastReloadAt: null,
    lastStatus: "budget_reached",
  };
  assert.equal(runnerMinutesAutoReloadLastLine(settings), RUNNER_MINUTES_AUTO_RELOAD_BUDGET_REACHED_LINE);
});
