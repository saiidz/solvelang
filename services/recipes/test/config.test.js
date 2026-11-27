import assert from "node:assert/strict";
import test from "node:test";

import {
  INVALID_CONFIG_NOTE,
  enabledRecipes,
  parseRecipesConfig,
} from "../src/config.js";
import { createRegistry } from "../src/registry.js";

// QA pins for .github/solvelang-recipes.json parsing: valid files
// parse, every defect yields all-off defaults PLUS the visible note
// (never a silent downgrade), and an absent file is not an error.

test("absent config file is defaults, not invalid, no note", () => {
  const result = parseRecipesConfig(null);
  assert.equal(result.invalid, false);
  assert.equal(result.present, false);
  assert.equal(result.note, null);
  assert.deepEqual(enabledRecipes(result.config), []);
});

test("valid config parses entries with cadence, trigger and options", () => {
  const result = parseRecipesConfig(
    JSON.stringify({
      version: 1,
      recipes: {
        "lint-autofix": { enabled: true, cadence: "weekly", options: { tool: "eslint" } },
        "code-review": { enabled: false, trigger: "pull_request" },
        "dependency-secret-scanner": { enabled: true, cadence: "0 6 * * 1" },
      },
    })
  );
  assert.equal(result.invalid, false);
  assert.equal(result.present, true);
  const enabled = enabledRecipes(result.config);
  assert.deepEqual(
    enabled.map((entry) => entry.definition.id),
    ["lint-autofix", "dependency-secret-scanner"]
  );
  assert.equal(result.config.recipes["lint-autofix"].options.tool, "eslint");
});

test("unparseable config yields all-off defaults plus the visible note", () => {
  const result = parseRecipesConfig("{not json");
  assert.equal(result.invalid, true);
  assert.equal(result.note, INVALID_CONFIG_NOTE);
  assert.deepEqual(enabledRecipes(result.config), []);
});

test("every shape defect is invalid with the note, never a partial parse", () => {
  const defects = [
    JSON.stringify({ version: 2, recipes: {} }),
    JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, recipes: [] }),
    JSON.stringify({ version: 1, recipes: { "no-such-recipe": { enabled: true } } }),
    JSON.stringify({ version: 1, recipes: { "lint-autofix": { enabled: "yes" } } }),
    JSON.stringify({ version: 1, recipes: { "lint-autofix": {} } }),
    JSON.stringify({ version: 1, recipes: { "lint-autofix": { enabled: true, cadence: "fortnightly" } } }),
    // trigger the recipe does not support (lint-autofix has no pull_request class)
    JSON.stringify({ version: 1, recipes: { "lint-autofix": { enabled: true, trigger: "pull_request" } } }),
    JSON.stringify({ version: 1, recipes: { "lint-autofix": { enabled: true, options: [] } } }),
    JSON.stringify(["not", "an", "object"]),
  ];
  for (const text of defects) {
    const result = parseRecipesConfig(text);
    assert.equal(result.invalid, true, text);
    assert.equal(result.note, INVALID_CONFIG_NOTE, text);
    assert.deepEqual(result.config, { version: 1, recipes: {} }, text);
  }
});

test("an internal test recipe id is a valid config key only in its own registry", () => {
  const text = JSON.stringify({
    version: 1,
    recipes: { "stage0-fixture-probe": { enabled: true, cadence: "daily" } },
  });
  assert.equal(parseRecipesConfig(text).invalid, true);
  const registry = createRegistry([
    {
      id: "stage0-fixture-probe",
      title: "probe",
      triggerClasses: ["manual", "schedule"],
      identityClass: "scan",
      internal: true,
    },
  ]);
  const result = parseRecipesConfig(text, registry);
  assert.equal(result.invalid, false);
  assert.equal(enabledRecipes(result.config, registry).length, 1);
});
