// SolveLang PR Gate — home policy pin.
//
// This repository runs the PR Gate on itself (see .github/workflows/pr-gate.yml
// at the repository root). This test pins the starter policy file that lives
// at the repository root so an accidental edit cannot silently drop the
// protected paths the activation shipped with.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parsePolicy } from "../src/policy";

// Compiled tests live at <root>/packages/pr-gate/dist/packages/pr-gate/test.
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..", "..", "..");

test("the home repository policy parses and keeps its starter protected paths", () => {
  const policyFile = path.join(repoRoot, "pr-gate.policy.json");
  assert.ok(existsSync(policyFile), `expected the home policy at ${policyFile}`);
  const policy = parsePolicy(readFileSync(policyFile, "utf8"));
  assert.equal(policy.version, 1);
  assert.equal(policy.overrideLabel, "pr-gate:override");
  const globs = (policy.protectedPaths ?? []).map((entry) => entry.glob).sort();
  assert.deepEqual(globs, [".github/workflows/**", "services/api-access/src/**"]);
});
