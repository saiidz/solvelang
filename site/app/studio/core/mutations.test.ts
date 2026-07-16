import test from "node:test";
import assert from "node:assert/strict";
import { addScenarioToWorkflow, applyWorkflowMutation, parseFiniteInteger } from "./mutations";
import { createProjectRepository } from "./storage";
import { createBlankWorkflow, createSupportTriageDocument, makeNode } from "./templates";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function savedFixture() {
  const storage = new MemoryStorage();
  const repository = createProjectRepository(storage);
  const document = createSupportTriageDocument();
  assert.equal(repository.save(document).status, "ok");
  return { storage, repository, document };
}

test("blank workflows cannot create scenarios without a trigger", () => {
  const blank = createBlankWorkflow();
  const result = addScenarioToWorkflow(blank, "scenario-blocked");
  assert.equal(result.ok, false);
  assert.equal(result.error, "Add a trigger node first.");
  assert.equal(result.document, blank);
  assert.deepEqual(blank.scenarios, []);
});

test("trigger and scenario creation survives save and reload", () => {
  const storage = new MemoryStorage();
  const repository = createProjectRepository(storage);
  const blank = createBlankWorkflow();
  const withTrigger = applyWorkflowMutation(blank, (draft) => {
    draft.nodes.push(makeNode("trigger-created", "trigger", "Created trigger", 0, 0));
    return draft;
  });
  assert.equal(withTrigger.ok, true);
  const withScenario = addScenarioToWorkflow(withTrigger.document, "scenario-created");
  assert.equal(withScenario.ok, true);
  assert.equal(repository.save(withScenario.document).status, "ok");
  const loaded = createProjectRepository(storage).load(withScenario.document.id);
  assert.equal(loaded.status, "ok");
  assert.equal(loaded.document?.scenarios[0].startingTrigger, "trigger-created");
});

test("referenced triggers cannot be deleted or converted", () => {
  const { repository, document: current } = savedFixture();
  const lastValid = structuredClone(current);
  const triggerId = current.scenarios[0].startingTrigger;
  const deleted = applyWorkflowMutation(current, (draft) => {
    draft.nodes = draft.nodes.filter((node) => node.id !== triggerId);
    draft.edges = draft.edges.filter((edge) => edge.source !== triggerId && edge.target !== triggerId);
    return draft;
  });
  assert.equal(deleted.ok, false);
  assert.equal(deleted.document, current);
  const converted = applyWorkflowMutation(current, (draft) => {
    const trigger = draft.nodes.find((node) => node.id === triggerId)!;
    trigger.type = "action";
    return draft;
  });
  assert.equal(converted.ok, false);
  assert.equal(converted.document, current);
  assert.equal(current.nodes.find((node) => node.id === triggerId)?.type, "trigger");
  assert.deepEqual(repository.load(current.id).document, lastValid);
});

test("a rejected scenario mutation leaves a saved blank workflow reloadable", () => {
  const storage = new MemoryStorage();
  const repository = createProjectRepository(storage);
  const blank = createBlankWorkflow();
  assert.equal(repository.save(blank).status, "ok");
  const rejected = applyWorkflowMutation(blank, (draft) => {
    draft.scenarios.push({ id: "invalid-scenario", name: "Invalid", description: "", startingTrigger: "", inputVariables: {}, decisionOutcomes: {}, expectedTerminalState: "", expectedHumanReviewPoints: [], expectedOutputs: [] });
    return draft;
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.document, blank);
  const loaded = createProjectRepository(storage).load(blank.id);
  assert.equal(loaded.status, "ok");
  assert.deepEqual(loaded.document, blank);
});

test("numeric parser rejects empty, decimal, negative SLA, and non-finite values", () => {
  for (const value of ["", "1.5", "NaN", "Infinity", "-Infinity"]) assert.equal(parseFiniteInteger(value).ok, false, value);
  for (const value of ["1.5", "-1", "NaN", "Infinity", "-Infinity"]) assert.equal(parseFiniteInteger(value, { nullable: true, minimum: 0 }).ok, false, value);
  assert.deepEqual(parseFiniteInteger("", { nullable: true, minimum: 0 }), { ok: true, value: null });
  assert.deepEqual(parseFiniteInteger("3", { minimum: 0 }), { ok: true, value: 3 });
});

test("rejected numeric edits preserve the last valid project in memory and storage", () => {
  for (const [label, mutate] of [
    ["decimal priority", (draft: ReturnType<typeof createSupportTriageDocument>) => { draft.edges[0].priority = 1.5; }],
    ["decimal SLA", (draft: ReturnType<typeof createSupportTriageDocument>) => { draft.nodes[0].slaMinutes = 1.5; }],
    ["negative SLA", (draft: ReturnType<typeof createSupportTriageDocument>) => { draft.nodes[0].slaMinutes = -1; }],
    ["non-finite priority", (draft: ReturnType<typeof createSupportTriageDocument>) => { draft.edges[0].priority = Number.POSITIVE_INFINITY; }],
    ["non-finite SLA", (draft: ReturnType<typeof createSupportTriageDocument>) => { draft.nodes[0].slaMinutes = Number.NaN; }],
  ] as const) {
    const { repository, document } = savedFixture();
    const before = structuredClone(document);
    const result = applyWorkflowMutation(document, (draft) => { mutate(draft); return draft; });
    assert.equal(result.ok, false, label);
    assert.equal(result.document, document, label);
    assert.deepEqual(document, before, label);
    const loaded = repository.load(document.id);
    assert.equal(loaded.status, "ok", label);
    assert.deepEqual(loaded.document, before, label);
  }
});

test("project repository refuses invalid documents without replacing the last valid save", () => {
  const { repository, document } = savedFixture();
  const invalid = structuredClone(document);
  invalid.edges[0].priority = 1.5;
  const result = repository.save(invalid);
  assert.equal(result.status, "invalid");
  const loaded = repository.load(document.id);
  assert.equal(loaded.status, "ok");
  assert.deepEqual(loaded.document, document);
});
