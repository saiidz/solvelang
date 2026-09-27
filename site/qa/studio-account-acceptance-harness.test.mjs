import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { assertAcceptanceTargets, assertTestOwnedWorkspace, classifyAcceptanceFailure, clickAndAccept, compareAccountDigests, connect, createFreshWorkspace, qualifyLocalWorkspace, reversibleRemoval, sanitizeEvidence, showAccountWorkspace, TEST_NAMES } from "./studio-account-acceptance.mjs";

const digest = (character) => character.repeat(64);
const expected = { owner: digest("c"), a: digest("a"), b: digest("b") };
const workspace = { schemaVersion: 1, projects: [{ document: { name: "Studio acceptance A 20260924123456" } }] };

test("creating a workflow moves to Canvas, then account connection returns to Projects", async () => {
  let view = "projects";
  const actions = [];
  const accountButton = (name) => ({ async click() {
    if (view !== "projects") throw new Error("Account controls are hidden on Canvas");
    actions.push(name);
  } });
  const account = {
    async waitFor() { if (view !== "projects") throw new Error("Account workspace is hidden"); },
    getByRole(role, { name } = {}) {
      if (role === "button") return accountButton(name);
      if (role === "status") return { filter: () => ({ waitFor: async () => {} }), innerText: async () => "Connected to disposable account" };
      throw new Error("Unexpected account lookup");
    },
  };
  const page = {
    getByRole(role, { name } = {}) {
      if (role === "button" && name instanceof RegExp && name.test("Create blank workflow")) return { async click() { view = "canvas"; actions.push("create"); } };
      if (role === "button" && name === "Connect / refresh account") return accountButton(name);
      if (role === "textbox" && name === "Project name") return { fill: async () => {}, press: async () => {} };
      if (role === "navigation" && name === "Studio navigation") return { getByRole(buttonRole, { name: buttonName }) {
        assert.equal(buttonRole, "button");
        assert.match("01Projects", buttonName);
        return { async click() { view = "projects"; actions.push("Projects"); } };
      } };
      if (role === "region" && name === "Account workspace") return account;
      throw new Error("Unexpected page lookup");
    },
    waitForTimeout: async () => {},
    waitForResponse: async () => ({ ok: () => true, json: async () => ({ accountId: "disposable", workspace: { projects: [] } }) }),
    waitForFunction: async () => {},
  };

  await createFreshWorkspace(page, "Studio acceptance A");
  assert.equal(view, "canvas");
  await assert.rejects(accountButton("Connect / refresh account").click(), /hidden on Canvas/);
  await connect(page);
  assert.equal(view, "projects");
  assert.deepEqual(actions, ["create", "Projects", "Connect / refresh account"]);
  await (await showAccountWorkspace(page)).getByRole("button", { name: "Save workspace and enable autosave" }).click();
  assert.deepEqual(actions.slice(-2), ["Projects", "Save workspace and enable autosave"]);
});

test("account connection waits for its refresh and new UI state before reading projects", async () => {
  let releaseResponse, releaseReady, settled = false;
  const response = new Promise((resolve) => { releaseResponse = () => resolve({
    ok: () => true,
    json: async () => ({ accountId: "disposable", workspace: { projects: [{ document: { name: "Test project" } }] } }),
  }); });
  const ready = new Promise((resolve) => { releaseReady = resolve; });
  const status = {
    innerText: async () => "Connected to disposable account",
  };
  const account = {
    waitFor: async () => {},
    getByRole(role) { return role === "status" ? status : { click: async () => {} }; },
  };
  const rendered = { status: "Connected to account disposable. 0 saved projects. Nothing has been uploaded.", names: [] };
  const region = {
    querySelectorAll: (selector) => selector === "button" ? [{ textContent: "Connect / refresh account", disabled: false }]
      : rendered.names.map((name) => ({ firstChild: { textContent: name } })),
    querySelector: () => ({ textContent: rendered.status }),
  };
  const page = {
    getByRole(role) {
      if (role === "navigation") return { getByRole: () => ({ click: async () => {} }) };
      if (role === "region") return account;
      throw new Error("Unexpected page lookup");
    },
    waitForResponse: (matches, options) => {
      assert.equal(matches({ url: () => "https://3l3y008e94.execute-api.us-east-2.amazonaws.com/customer/studio/workspace", request: () => ({ method: () => "GET" }) }), true);
      assert.equal(options.timeout, 20_000);
      return response;
    },
    waitForFunction: (predicate, expected, options) => {
      assert.equal(options.timeout, 20_000);
      assert.equal(options.polling, 100);
      assert.deepEqual(expected, { status: "Connected to account disposable. 1 saved projects. Nothing has been uploaded.", names: ["Test project"] });
      const matches = () => runInNewContext(`(${predicate.toString()})(expected)`, { document: { querySelector: () => region }, expected });
      assert.equal(matches(), false, "the stale connected status and list must not qualify");
      return ready.then(() => {
        rendered.status = expected.status;
        rendered.names = expected.names;
        assert.equal(matches(), true, "the matching completed state must qualify without observing a transient disabled button");
      });
    },
  };
  const pending = connect(page).then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "the initial visible status must not complete account refresh");
  releaseResponse();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "a response must not complete refresh before the new UI state is ready");
  releaseReady();
  await pending;
  assert.equal(settled, true);
});

test("confirmation is accepted while the click is still pending", async () => {
  const steps = [];
  let showDialog, releaseClick;
  const dialogShown = new Promise((resolve) => { showDialog = resolve; });
  const clickReleased = new Promise((resolve) => { releaseClick = resolve; });
  const page = {
    waitForEvent(event) {
      assert.equal(event, "dialog");
      return dialogShown;
    },
  };
  const locator = {
    async click() {
      steps.push("click started");
      queueMicrotask(() => showDialog({
        type: () => "confirm",
        async accept() { steps.push("confirm accepted"); releaseClick(); },
      }));
      await clickReleased;
      steps.push("click completed");
    },
  };
  let timer;
  try {
    await Promise.race([
      clickAndAccept(page, locator),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("click waited for an unhandled confirm")), 500); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.deepEqual(steps, ["click started", "confirm accepted", "click completed"]);
});

test("unexpected dialogs are dismissed and reject the destructive click", async () => {
  let accepted = false, dismissed = false;
  const page = { waitForEvent: async () => ({
    type: () => "alert",
    accept: async () => { accepted = true; },
    dismiss: async () => { dismissed = true; },
  }) };
  await assert.rejects(clickAndAccept(page, { click: async () => {} }), /confirm/);
  assert.equal(accepted, false);
  assert.equal(dismissed, true);
});

test("a destructive click fails when no confirmation appears", async () => {
  const page = { waitForEvent: async (event, options) => {
    assert.equal(event, "dialog");
    assert.equal(options.timeout, 5_000);
    throw new Error("confirmation timeout");
  } };
  await assert.rejects(clickAndAccept(page, { click: async () => {} }), /confirmation timeout/);
});

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

test("a fresh profile's pristine starter is qualified once and later modifications fail closed", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "studio-seed-test-"));
  const seedFile = path.join(directory, "seed.sha256");
  const starter = { name: "Support triage workspace", id: "workflow-pristine", nodes: [{ id: "node-1" }] };
  const project = { document: starter, versions: [], traces: [] };
  const page = { evaluate: async () => ({ schemaVersion: 1, projects: [project] }) };
  try {
    const digest = await qualifyLocalWorkspace(page, seedFile, true);
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.doesNotThrow(() => assertTestOwnedWorkspace({ schemaVersion: 1, projects: [project] }, digest));
    assert.equal(await qualifyLocalWorkspace(page, seedFile, false), digest);
    const changed = { evaluate: async () => ({ schemaVersion: 1, projects: [{ ...project, traces: [{ private: true }] }] }) };
    await assert.rejects(qualifyLocalWorkspace(changed, seedFile, false), /starter project changed/);
    assert.throws(() => assertTestOwnedWorkspace({ schemaVersion: 1, projects: [project] }), /non-test/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
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
  const evidence = sanitizeEvidence([{ name: TEST_NAMES[0], pass: true, result: "private workflow csrf cookie accountId" }, { name: "private project", pass: false, category: "secret", result: "secret" }], "commit");
  assert.deepEqual(Object.keys(evidence).sort(), ["acceptanceOrigin", "generatedAt", "testedCommit", "tests"].sort());
  assert.deepEqual(evidence.tests, [{ name: TEST_NAMES[0], pass: true, result: "verified" }, { name: "qualification", pass: false, result: "failed", category: "operation_failed" }]);
  assert.doesNotMatch(JSON.stringify(evidence), /private workflow|private project|secret|csrf|cookie|accountId/);
});

test("failure evidence retains only a bounded diagnostic category", () => {
  const timeout = Object.assign(new Error("private email and project content"), { name: "TimeoutError" });
  assert.equal(classifyAcceptanceFailure(new Error("projects_navigation_failed")), "projects_navigation_failed");
  assert.equal(classifyAcceptanceFailure(timeout), "ui_timeout");
  assert.equal(classifyAcceptanceFailure(new Error("private email and project content")), "operation_failed");
  const evidence = sanitizeEvidence([{ name: TEST_NAMES[0], pass: false, category: classifyAcceptanceFailure(timeout) }]);
  assert.deepEqual(evidence.tests, [{ name: TEST_NAMES[0], pass: false, result: "failed", category: "ui_timeout" }]);
  assert.doesNotMatch(JSON.stringify(evidence), /private email|project content/);
});
