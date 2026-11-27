import assert from "node:assert/strict";
import test from "node:test";

import { createRegistry, defaultRegistry } from "../src/registry.js";

// QA pins for the Stage 0 catalog registry: the 8 program recipes,
// their trigger/identity classes, and the claims discipline that no
// recipe is proven (hence none is publicly available) in Stage 0.

const EXPECTED = {
  "license-headers": { triggers: ["schedule", "manual"], identity: "process-solution-app" },
  "import-organization": { triggers: ["schedule", "manual"], identity: "process-solution-app" },
  "lint-autofix": { triggers: ["schedule", "manual"], identity: "process-solution-app" },
  "error-message-refactors": { triggers: ["schedule", "manual"], identity: "process-solution-app" },
  "matrix-monorepo-analysis": { triggers: ["pull_request", "manual"], identity: "verification-app" },
  "dependency-secret-scanner": { triggers: ["schedule", "manual"], identity: "scan" },
  "code-review": { triggers: ["pull_request", "manual"], identity: "verification-app" },
  "security-review": { triggers: ["pull_request", "schedule", "manual"], identity: "verification-app" },
};

test("registry holds exactly the 8 program recipes with their classes", () => {
  const catalog = defaultRegistry.catalog();
  assert.equal(catalog.length, 8);
  assert.deepEqual(
    catalog.map((recipe) => recipe.id).sort(),
    Object.keys(EXPECTED).sort()
  );
  for (const recipe of catalog) {
    assert.deepEqual([...recipe.triggerClasses], EXPECTED[recipe.id].triggers, recipe.id);
    assert.equal(recipe.identityClass, EXPECTED[recipe.id].identity, recipe.id);
  }
});

test("claims discipline: every recipe starts unproven and the public catalog is empty", () => {
  for (const recipe of defaultRegistry.catalog()) {
    assert.equal(recipe.proven, false, recipe.id);
  }
  assert.deepEqual(defaultRegistry.publicCatalog(), []);
});

test("internal test recipes never appear in the catalog, even if marked proven", () => {
  const registry = createRegistry([
    {
      id: "stage0-fixture-probe",
      title: "Stage 0 fixture probe (internal)",
      triggerClasses: ["manual", "schedule"],
      identityClass: "scan",
      proven: true,
      internal: true,
    },
  ]);
  assert.equal(registry.catalog().length, 8);
  assert.deepEqual(registry.publicCatalog(), []);
  assert.equal(registry.get("stage0-fixture-probe").internal, true);
});

test("registry rejects duplicate and malformed definitions", () => {
  assert.throws(
    () =>
      createRegistry([
        { id: "code-review", title: "dup", triggerClasses: ["manual"], identityClass: "scan" },
      ]),
    /recipe_definition_duplicate/
  );
  assert.throws(
    () =>
      createRegistry([
        { id: "Bad Id", title: "x", triggerClasses: ["manual"], identityClass: "scan" },
      ]),
    /recipe_definition_invalid/
  );
  assert.throws(
    () =>
      createRegistry([
        { id: "ok-id", title: "x", triggerClasses: ["telepathy"], identityClass: "scan" },
      ]),
    /recipe_definition_invalid/
  );
  assert.throws(
    () =>
      createRegistry([
        { id: "ok-id", title: "x", triggerClasses: ["manual"], identityClass: "root-shell" },
      ]),
    /recipe_definition_invalid/
  );
});
