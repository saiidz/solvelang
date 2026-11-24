import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RUNNER_MINUTES_AUTO_RELOAD_BUDGET_REACHED_LINE } from "./runner-minutes-auto-reload";

// QA pins for the Auto-reload card's monthly budget row (root: the
// budget helpers in runner-minutes-auto-reload and the budget row
// in AutoReloadCard). These pin the wiring AROUND the root build:
//
//   1. The card renders the budget row (input, save, spend line,
//      reached line) from the shared core helpers — the reached
//      sentence lives in core only, never re-typed in the card.
//   2. The budget posts as { budgetCents } through the shared
//      auto-reload route, and the card re-reads the service state
//      after the write — no blind local flips.
//   3. The input is seeded once from the first view, so a pool
//      save's re-read cannot clobber a half-typed budget.

const autoReloadCard = readFileSync("app/account/home/AutoReloadCard.tsx", "utf8");
const core = readFileSync("app/account/core/runner-minutes-auto-reload.ts", "utf8");

test("the card renders the monthly budget row", () => {
  assert.ok(autoReloadCard.includes("Monthly budget"), "the row heading");
  assert.ok(autoReloadCard.includes("Budget (USD)"), "the dollar input label");
  assert.ok(autoReloadCard.includes("Save budget"), "the save button");
  assert.ok(autoReloadCard.includes("runnerMinutesAutoReloadBudgetSpendLine"), "the spend line comes from core");
  assert.ok(autoReloadCard.includes("budget.budgetReached"), "the reached state drives the reached line");
});

test("the reached line lives in core and the card imports it — never re-typed", () => {
  assert.ok(core.includes(RUNNER_MINUTES_AUTO_RELOAD_BUDGET_REACHED_LINE), "core carries the verbatim line");
  assert.ok(
    autoReloadCard.includes("RUNNER_MINUTES_AUTO_RELOAD_BUDGET_REACHED_LINE"),
    "the card imports the shared constant",
  );
  assert.ok(
    !autoReloadCard.includes("Monthly auto-reload budget reached"),
    "the card never re-types the sentence",
  );
});

test("the budget posts as whole cents through the shared route and re-reads after the write", () => {
  assert.ok(
    autoReloadCard.includes("runnerMinutesAutoReloadBudgetCentsFromInput"),
    "the input is parsed by the shared helper",
  );
  assert.ok(
    autoReloadCard.includes("JSON.stringify({ budgetCents: parsed.budgetCents })"),
    "the write body is exactly { budgetCents }",
  );
  const save = autoReloadCard.indexOf("async function saveBudget");
  const rereadCall = autoReloadCard.indexOf("await reread()", save);
  assert.ok(save >= 0 && rereadCall > save, "saveBudget re-reads the service state after posting");
});

test("the budget input is seeded once from the first view", () => {
  assert.ok(autoReloadCard.includes("budgetHydratedRef"), "a hydration guard exists");
  assert.ok(
    autoReloadCard.includes("runnerMinutesAutoReloadBudget(view)"),
    "the budget state is read through the shared normalizer",
  );
});

test("core reads the service's budget fields and derives reached with the service's rule", () => {
  assert.ok(core.includes("budgetCents?: number | null"), "the view type carries the cap");
  assert.ok(core.includes("spentThisMonthCents?: number"), "the view type carries the spend");
  assert.ok(
    core.includes("spentThisMonthCents >= budgetCents"),
    "reached is spend at or over the cap, like the service",
  );
});
