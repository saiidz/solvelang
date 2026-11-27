import assert from "node:assert/strict";
import test from "node:test";
import {
  RECIPE_CATALOG,
  RECIPES_NOT_AVAILABLE_LABEL,
  parseRecipeRepoStates,
  recipeDisplayStates,
} from "./recipes";

// QA pins for the account recipe catalog (Stage 0): the catalog
// mirrors the recipes-service registry, and the claims discipline —
// an unproven recipe NEVER displays as available, even when a repo
// config enables it.

test("catalog holds the 8 program recipes, all unproven", () => {
  assert.deepEqual(
    RECIPE_CATALOG.map((entry) => entry.id).sort(),
    [
      "code-review",
      "dependency-secret-scanner",
      "error-message-refactors",
      "import-organization",
      "license-headers",
      "lint-autofix",
      "matrix-monorepo-analysis",
      "security-review",
    ]
  );
  for (const entry of RECIPE_CATALOG) {
    assert.equal(entry.proven, false, entry.id);
    assert.ok(!entry.internal, entry.id);
  }
});

test("enabled + configured state never makes an unproven recipe available", () => {
  const states = recipeDisplayStates([
    { recipeId: "lint-autofix", configured: true, enabled: true },
    { recipeId: "code-review", configured: true, enabled: false },
  ]);
  assert.equal(states.length, 8);
  for (const state of states) {
    assert.equal(state.available, false, state.entry.id);
    assert.equal(state.availabilityLabel, RECIPES_NOT_AVAILABLE_LABEL, state.entry.id);
  }
  const lint = states.find((state) => state.entry.id === "lint-autofix");
  assert.equal(lint?.enabled, true);
  assert.equal(lint?.configLabel, "Enabled in repo config");
  const review = states.find((state) => state.entry.id === "code-review");
  assert.equal(review?.configLabel, "Not enabled in repo config");
  const unconfigured = states.find((state) => state.entry.id === "security-review");
  assert.equal(unconfigured?.configLabel, "Not configured");
});

test("payload parsing drops unknown ids and malformed entries, never invents state", () => {
  assert.deepEqual(parseRecipeRepoStates(null), []);
  assert.deepEqual(parseRecipeRepoStates({ recipes: "nope" }), []);
  assert.deepEqual(
    parseRecipeRepoStates({
      recipes: [
        { id: "lint-autofix", configured: true, enabled: true },
        { id: "stage0-fixture-probe", configured: true, enabled: true },
        { id: 42, configured: true },
        { id: "code-review", configured: "yes", enabled: 1 },
        null,
      ],
    }),
    [
      { recipeId: "lint-autofix", configured: true, enabled: true },
      { recipeId: "code-review", configured: false, enabled: false },
    ]
  );
});
