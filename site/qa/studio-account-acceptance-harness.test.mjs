import test from "node:test";
import assert from "node:assert/strict";
import { compareAccountDigests, sanitizeEvidence, TEST_NAMES } from "./studio-account-acceptance.mjs";

test("acceptance harness requires two distinct authenticated contexts", () => {
  assert.equal(compareAccountDigests("a".repeat(64), "b".repeat(64)), true);
  assert.throws(() => compareAccountDigests("a".repeat(64), "a".repeat(64)), /same backend account/);
  assert.throws(() => compareAccountDigests("a".repeat(64), "b".repeat(64), "a".repeat(64)), /owner account/);
  assert.throws(() => compareAccountDigests(null, "b".repeat(64)), /Both acceptance contexts/);
});

test("sanitized evidence contains only bounded test outcomes", () => {
  const evidence = sanitizeEvidence([{ name: TEST_NAMES[0], pass: true, result: "persistence verified" }], "commit");
  assert.deepEqual(Object.keys(evidence).sort(), ["acceptanceOrigin", "generatedAt", "testedCommit", "tests"].sort());
  assert.deepEqual(evidence.tests, [{ name: TEST_NAMES[0], pass: true, result: "persistence verified" }]);
  assert.equal(JSON.stringify(evidence).includes("accountId"), false);
  assert.equal(JSON.stringify(evidence).includes("csrf"), false);
  assert.equal(JSON.stringify(evidence).includes("cookie"), false);
});
