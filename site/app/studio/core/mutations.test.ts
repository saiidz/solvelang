import test from "node:test";
import assert from "node:assert/strict";
import { addScenarioToWorkflow, applyWorkflowMutation, parseFiniteInteger, updateNodeAndReferences } from "./mutations";
import { createProjectRepository, persistWorkflowForActivation } from "./storage";
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

class DeniedWriteStorage extends MemoryStorage {
  writesBlocked = false;
  override setItem(key: string, value: string) {
    if (this.writesBlocked) throw new Error("quota");
    super.setItem(key, value);
  }
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

test("referenced node outputs rename atomically and survive save and reload", () => {
  const { repository, document } = savedFixture();
  const node = structuredClone(document.nodes.find((item) => item.outputs.includes("resolved"))!);
  node.outputs = node.outputs.map((output) => output === "resolved" ? "resolution_recorded" : output);
  const result = updateNodeAndReferences(document, node);
  assert.equal(result.ok, true);
  assert.equal(result.document.scenarios.some((scenario) => scenario.expectedOutputs.includes("resolved")), false);
  assert.equal(result.document.scenarios.some((scenario) => scenario.expectedOutputs.includes("resolution_recorded")), true);
  assert.equal(repository.save(result.document).status, "ok");
  const loaded = repository.load(document.id);
  assert.equal(loaded.status, "ok");
  assert.deepEqual(loaded.document, result.document);
});

test("multiple scenarios and outputs migrate by position and deduplicate expectations", () => {
  const { document } = savedFixture();
  const source = document.nodes.find((item) => item.outputs.includes("resolved"))!;
  const renamed = structuredClone(source);
  renamed.outputs = renamed.outputs.map((output) => output === "resolved" ? "resolution_recorded" : output);
  const secondScenario = structuredClone(document.scenarios[0]);
  secondScenario.id = "scenario-second";
  secondScenario.expectedOutputs = ["resolved", "resolution_recorded"];
  const current = { ...document, scenarios: [...document.scenarios, secondScenario] };
  const result = updateNodeAndReferences(current, renamed);
  assert.equal(result.ok, true);
  assert.equal(result.document.scenarios.some((scenario) => scenario.expectedOutputs.includes("resolved")), false);
  assert.equal(result.document.scenarios.filter((scenario) => scenario.expectedOutputs.includes("resolution_recorded")).length, 3);
  assert.equal(result.document.scenarios.find((scenario) => scenario.id === "scenario-second")?.expectedOutputs.length, 1);
});

test("referenced output removal, empty names, duplicates, and cross-node collisions fail closed", () => {
  const { repository, document } = savedFixture();
  const source = document.nodes.find((item) => item.outputs.includes("resolved"))!;
  const before = JSON.stringify(document);
  for (const outputs of [source.outputs.filter((output) => output !== "resolved"), [""], ["resolved", "resolved"]]) {
    const candidate = structuredClone(source); candidate.outputs = outputs;
    const result = updateNodeAndReferences(document, candidate);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result.document), before);
  }
  const other = document.nodes.find((item) => item.id !== source.id)!;
  const collision = structuredClone(source); collision.outputs = [...source.outputs.slice(0, -1), other.outputs[0] ?? "shared"];
  const result = updateNodeAndReferences(document, collision);
  assert.equal(result.ok, false);
  assert.deepEqual(repository.load(document.id).document, document);
});

test("failed project save preserves the previous stored bytes", () => {
  const { storage, repository, document } = savedFixture();
  const before = storage.getItem("solvelang.studio.projects.v1");
  const originalSetItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (key === "solvelang.studio.projects.v1") throw new Error("quota"); originalSetItem(key, value); };
  const replacement = structuredClone(document); replacement.name = "Should not replace";
  assert.equal(repository.save(replacement).status, "unavailable");
  assert.equal(storage.getItem("solvelang.studio.projects.v1"), before);
  assert.deepEqual(repository.load(document.id).document, document);
});

test("activation save fails closed for every project entry point", () => {
  for (const source of ["blank", "template", "wizard", "version", "import"]) {
    const storage = new DeniedWriteStorage();
    const repository = createProjectRepository(storage);
    const active = createSupportTriageDocument();
    assert.equal(repository.save(active).status, "ok");
    const before = storage.getItem("solvelang.studio.projects.v1");
    const projects = [active];
    const analytics: string[] = [];
    storage.writesBlocked = true;

    const candidate = createBlankWorkflow();
    candidate.name = `${source} candidate`;
    const result = persistWorkflowForActivation(repository, candidate);
    if (result.status === "ok") {
      projects.unshift(result.document);
      analytics.push(`${source}_succeeded`);
    }

    assert.equal(result.status, "unavailable", source);
    assert.deepEqual(projects, [active], source);
    assert.deepEqual(analytics, [], source);
    assert.equal(storage.getItem("solvelang.studio.projects.v1"), before, source);
    assert.deepEqual(repository.load(active.id).document, active, source);
  }
});

test("activation save rejects unavailable storage and persists valid workflows on success", () => {
  const document = createSupportTriageDocument();
  const unavailable = persistWorkflowForActivation(null, document);
  assert.equal(unavailable.status, "unavailable");
  assert.match(unavailable.error, /unavailable/i);

  const storage = new MemoryStorage();
  const repository = createProjectRepository(storage);
  const saved = persistWorkflowForActivation(repository, document);
  assert.equal(saved.status, "ok");
  assert.deepEqual(repository.load(document.id).document, document);
});

test("multiple output renames preserve unrelated expectations in every scenario", () => {
  const { document } = savedFixture();
  const current = structuredClone(document);
  const currentNode = current.nodes.find((item) => item.outputs.includes("resolved"))!;
  currentNode.outputs = ["resolved", "follow_up"];
  current.scenarios[0].expectedOutputs = ["resolved", "follow_up", "escalated"];
  current.scenarios[1].expectedOutputs = ["follow_up", "escalated"];
  const node = structuredClone(currentNode);
  node.outputs = ["resolution_recorded", "follow_up_scheduled"];

  const result = updateNodeAndReferences(current, node);
  assert.equal(result.ok, true);
  for (const scenario of result.document.scenarios.slice(0, 2)) {
    assert.equal(scenario.expectedOutputs.includes("follow_up"), false);
    assert.equal(scenario.expectedOutputs.includes("follow_up_scheduled"), true);
    assert.equal(scenario.expectedOutputs.includes("escalated"), true);
  }
  assert.equal(result.document.scenarios[0].expectedOutputs.includes("resolution_recorded"), true);
});

test("removing an unreferenced output preserves referenced outputs", () => {
  const { document } = savedFixture();
  const current = structuredClone(document);
  const currentNode = current.nodes.find((item) => item.outputs.includes("resolved"))!;
  currentNode.outputs.push("unused_output");
  const node = structuredClone(currentNode);
  node.outputs = ["resolved"];

  const result = updateNodeAndReferences(current, node);
  assert.equal(result.ok, true);
  assert.equal(result.document.scenarios.some((scenario) => scenario.expectedOutputs.includes("resolved")), true);
});

test("rejected output edits preserve stored bytes and remain reloadable", () => {
  const { storage, repository, document } = savedFixture();
  const before = storage.getItem("solvelang.studio.projects.v1");
  const node = structuredClone(document.nodes.find((item) => item.outputs.includes("resolved"))!);
  node.outputs = node.outputs.filter((output) => output !== "resolved");

  const result = updateNodeAndReferences(document, node);
  assert.equal(result.ok, false);
  assert.equal(storage.getItem("solvelang.studio.projects.v1"), before);
  assert.deepEqual(repository.load(document.id).document, document);
});
