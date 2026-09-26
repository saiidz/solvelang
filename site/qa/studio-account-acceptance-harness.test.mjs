import test from "node:test";
import assert from "node:assert/strict";
import { assertAcceptanceTargets, assertTestOwnedWorkspace, compareAccountDigests, reversibleRemoval, sanitizeEvidence, TEST_NAMES } from "./studio-account-acceptance.mjs";

const digest = (character) => character.repeat(64);
const expected = { owner: digest("c"), a: digest("a"), b: digest("b") };
const workspace = { schemaVersion: 1, projects: [{ document: { name: "Studio acceptance A 20260924123456" } }] };

test("owner and both exact disposable identities are mandatory before account writes", () => {
  assert.equal(compareAccountDigests(expected.a, expected.b, expected), true);
  assert.throws(() => compareAccountDigests(expected.a, expected.b), /required/);
  assert.throws(() => compareAccountDigests(expected.owner, expected.b, expected), /owner account/);
  assert.throws(() => compareAccountDigests(digest("d"), expected.b, expected), /not the qualified disposable/);
  assert.throws(() => compareAccountDigests(expected.a, expected.a, expected), /same backend account/);
  assert.throws(() => compareAccountDigests(null, expected.b, expected), /Both acceptance contexts/);
  assert.throws(() => compareAccountDigests(expected.a, expected.b, { ...expected, owner: "" }), /required/);
  assert.throws(() => compareAccountDigests(expected.a, expected.b, { ...expected, owner: expected.a }), /distinct/);
});

test("non-test account content fails closed", () => {
  assert.doesNotThrow(() => assertTestOwnedWorkspace({ schemaVersion: 1, projects: [] }));
  assert.doesNotThrow(() => assertTestOwnedWorkspace(workspace));
  assert.throws(() => assertTestOwnedWorkspace({ schemaVersion: 1, projects: [{ document: { name: "Private workflow" } }] }), /non-test/);
});

test("the harness cannot point at a different origin or API", () => {
  const origin = "https://studio-acceptance.d3j3fgk4gcxxg2.amplifyapp.com";
  const api = "https://3l3y008e94.execute-api.us-east-2.amazonaws.com";
  assert.doesNotThrow(() => assertAcceptanceTargets(origin, api));
  assert.throws(() => assertAcceptanceTargets("https://www.solve-lang.com", api), /exact protected preview/);
  assert.throws(() => assertAcceptanceTargets(origin, "https://other.example"), /exact protected preview/);
});

test("export, removal and restoration leave the exact prior snapshot and local work", async () => {
  let remote = structuredClone(workspace), local = "local-before";
  const actions = [];
  await reversibleRemoval({
    read: async () => ({ workspace: structuredClone(remote) }),
    exportBackup: async () => { actions.push("export"); return structuredClone(remote); },
    remove: async () => { actions.push("remove"); remote = { schemaVersion: 1, projects: [] }; },
    restore: async (before) => { actions.push("restore"); remote = structuredClone(before.workspace); },
    localDigest: async () => local,
  });
  assert.deepEqual(actions, ["export", "remove", "restore"]);
  assert.deepEqual(remote, workspace);
  assert.equal(local, "local-before");
});

test("a failed removal still restores the prior snapshot", async () => {
  let remote = structuredClone(workspace), restored = false;
  await assert.rejects(reversibleRemoval({
    read: async () => ({ workspace: structuredClone(remote) }),
    exportBackup: async () => structuredClone(remote),
    remove: async () => { remote = { schemaVersion: 1, projects: [] }; throw new Error("interrupted after write"); },
    restore: async (before) => { remote = structuredClone(before.workspace); restored = true; },
    localDigest: async () => "unchanged",
  }), /interrupted/);
  assert.equal(restored, true);
  assert.deepEqual(remote, workspace);
});

test("local changes after removal are detected after account restoration", async () => {
  let remote = structuredClone(workspace), local = "before";
  await assert.rejects(reversibleRemoval({
    read: async () => ({ workspace: structuredClone(remote) }),
    exportBackup: async () => structuredClone(remote),
    remove: async () => { remote = { schemaVersion: 1, projects: [] }; local = "changed"; },
    restore: async (before) => { remote = structuredClone(before.workspace); },
    localDigest: async () => local,
  }), /Browser-local projects changed/);
  assert.deepEqual(remote, workspace);
});

test("unverified export and non-test content cannot execute removal", async () => {
  let removals = 0;
  const shared = { remove: async () => { removals++; }, restore: async () => {}, localDigest: async () => "local" };
  await assert.rejects(reversibleRemoval({ ...shared, read: async () => ({ workspace }), exportBackup: async () => ({ schemaVersion: 1, projects: [] }) }), /export/);
  await assert.rejects(reversibleRemoval({ ...shared, read: async () => ({ workspace: { schemaVersion: 1, projects: [{ document: { name: "Private workflow" } }] } }), exportBackup: async () => workspace }), /non-test/);
  assert.equal(removals, 0);
});

test("sanitized evidence excludes caller-controlled content", () => {
  const evidence = sanitizeEvidence([{ name: TEST_NAMES[0], pass: true, result: "private workflow csrf cookie accountId" }, { name: "private project", pass: false, result: "secret" }], "commit");
  assert.deepEqual(Object.keys(evidence).sort(), ["acceptanceOrigin", "generatedAt", "testedCommit", "tests"].sort());
  assert.deepEqual(evidence.tests, [{ name: TEST_NAMES[0], pass: true, result: "verified" }, { name: "qualification", pass: false, result: "failed" }]);
  assert.doesNotMatch(JSON.stringify(evidence), /private workflow|private project|secret|csrf|cookie|accountId/);
});
