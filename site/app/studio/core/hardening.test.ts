import test from "node:test";
import assert from "node:assert/strict";
import { calculateWorkflowAnalytics } from "./analytics";
import { analyzeWorkflow } from "./analysis";
import { exportAnalyticsCsv, exportMarkdownReport, generateSolveLangDraft, sanitizeFilename } from "./exports";
import { validSupportTriageFixture } from "./fixtures";
import { createLocalAnalytics } from "./productAnalytics";
import { parseWorkflowDocument } from "./schema";
import { simulateScenario } from "./simulation";
import { createArtifactRepository, createProjectRepository } from "./storage";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class ThrowingStorage implements Storage {
  get length(): number { throw new DOMException("blocked", "SecurityError"); }
  clear(): void { throw new DOMException("blocked", "SecurityError"); }
  getItem(): string | null { throw new DOMException("blocked", "SecurityError"); }
  key(): string | null { throw new DOMException("blocked", "SecurityError"); }
  removeItem(): void { throw new DOMException("blocked", "SecurityError"); }
  setItem(): void { throw new DOMException("quota", "QuotaExceededError"); }
}

test("imports reject duplicate IDs and broken graph references", () => {
  const duplicateNodes = validSupportTriageFixture();
  duplicateNodes.nodes[1].id = duplicateNodes.nodes[0].id;
  assert.equal(parseWorkflowDocument(duplicateNodes).ok, false);

  const duplicateEdges = validSupportTriageFixture();
  duplicateEdges.edges[1].id = duplicateEdges.edges[0].id;
  assert.equal(parseWorkflowDocument(duplicateEdges).ok, false);

  const brokenEdge = validSupportTriageFixture();
  brokenEdge.edges[0].target = "missing-node";
  assert.equal(parseWorkflowDocument(brokenEdge).ok, false);

  const brokenPolicy = validSupportTriageFixture();
  brokenPolicy.nodes[0].policyRefs = ["missing-policy"];
  assert.equal(parseWorkflowDocument(brokenPolicy).ok, false);

  const brokenScenario = validSupportTriageFixture();
  brokenScenario.scenarios[0].startingTrigger = "missing-trigger";
  assert.equal(parseWorkflowDocument(brokenScenario).ok, false);
});

test("imports reject unsafe object keys and unknown fields without rewriting", () => {
  const unsafe = JSON.parse(JSON.stringify(validSupportTriageFixture())) as Record<string, unknown>;
  const nodes = unsafe.nodes as Array<Record<string, unknown>>;
  nodes[0].metadata = JSON.parse('{"__proto__":"polluted"}');
  assert.equal(parseWorkflowDocument(unsafe).ok, false);

  const unknown = JSON.parse(JSON.stringify(validSupportTriageFixture())) as Record<string, unknown>;
  unknown.unrecognizedFutureField = true;
  assert.equal(parseWorkflowDocument(unknown).ok, false);
  assert.equal(({} as { polluted?: string }).polluted, undefined);
});

test("malformed and incompatible imports fail closed with useful errors", () => {
  const cases: Array<[string, unknown]> = [
    ["wrong root", []],
    ["future schema", { ...validSupportTriageFixture(), schemaVersion: 2 }],
    ["missing fields", { schemaVersion: 1, id: "partial" }],
    ["unknown node type", { ...validSupportTriageFixture(), nodes: [{ ...validSupportTriageFixture().nodes[0], type: "unknown" }] }],
    ["oversized text", { ...validSupportTriageFixture(), name: "x".repeat(100_001) }],
  ];
  for (const [label, input] of cases) {
    const result = parseWorkflowDocument(input);
    assert.equal(result.ok, false, label);
    if (!result.ok) assert.ok(result.error.length > 5, label);
  }
});

test("stored duplicate project identifiers are quarantined", () => {
  const storage = new MemoryStorage();
  const first = validSupportTriageFixture();
  const second = structuredClone(first);
  second.name = "Duplicate identity";
  storage.setItem("solvelang.studio.projects.v1", JSON.stringify([first, second]));
  const result = createProjectRepository(storage).loadAll();
  assert.equal(result.status, "corrupt");
  assert.ok(storage.getItem("solvelang.studio.quarantine.v1"));
});

test("storage denial and quota failures return controlled results", () => {
  const storage = new ThrowingStorage();
  const repository = createProjectRepository(storage);
  assert.doesNotThrow(() => repository.loadAll());
  assert.equal((repository.loadAll() as { status: string }).status, "unavailable");
  assert.doesNotThrow(() => repository.save(validSupportTriageFixture()));
  assert.equal((repository.save(validSupportTriageFixture()) as { status: string }).status, "unavailable");
  assert.doesNotThrow(() => createLocalAnalytics(storage).track("studio_opened"));
});

test("invalid version and trace artifacts are quarantined", () => {
  const storage = new MemoryStorage();
  const projectId = "workflow-corrupt";
  storage.setItem(`solvelang.studio.versions.v1.${projectId}`, JSON.stringify([{ bad: true }]));
  storage.setItem(`solvelang.studio.traces.v1.${projectId}`, JSON.stringify([{ bad: true }]));
  const repository = createArtifactRepository(storage);
  assert.deepEqual(repository.loadVersions(projectId), []);
  assert.deepEqual(repository.loadTraces(projectId), []);
  assert.ok(storage.getItem(`solvelang.studio.quarantine.v1.solvelang.studio.versions.v1.${projectId}`));
  assert.ok(storage.getItem(`solvelang.studio.quarantine.v1.solvelang.studio.traces.v1.${projectId}`));
});

test("text exports neutralize active content and spreadsheet formulas", () => {
  const workflow = validSupportTriageFixture();
  const payload = "<img src=x onerror=alert(1)>";
  workflow.name = payload;
  workflow.nodes[0].title = payload;
  workflow.nodes[0].id = "=HYPERLINK(\"https://example.invalid\")";
  const analysis = analyzeWorkflow(workflow);
  const runs = workflow.scenarios.map((scenario) => simulateScenario(workflow, scenario));
  const analytics = calculateWorkflowAnalytics(workflow, runs);
  analytics.scenario.mostFrequentlyTraversedNodes = ["=2+2"];

  const markdown = exportMarkdownReport(workflow, analysis, analytics);
  assert.doesNotMatch(markdown, /<img\b/i);
  assert.match(markdown, /&lt;img/);

  const csv = exportAnalyticsCsv(analytics);
  assert.match(csv, /'\=2\+2/);
  for (const formula of ["+cmd", "-1", "@sum"]) {
    analytics.scenario.mostFrequentlyTraversedNodes = [formula];
    assert.match(exportAnalyticsCsv(analytics), new RegExp(`'${formula.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
});

test("SolveLang drafts cannot inject executable lines through workflow text", () => {
  const workflow = validSupportTriageFixture();
  workflow.name = "Safe\nwrite_file(\"/tmp/pwned\", \"yes\")";
  workflow.policies[0].title = "Policy\nhttp_get(\"https://example.invalid\")";
  workflow.nodes[0].title = "Start\nask Evil(\"run\")";
  const draft = generateSolveLangDraft(workflow);
  assert.doesNotMatch(draft, /^write_file\(/m);
  assert.doesNotMatch(draft, /^http_get\(/m);
  assert.doesNotMatch(draft, /^ask Evil/m);
});

test("download filenames remove traversal and control characters", () => {
  const filename = sanitizeFilename("../../\u0000..\\secret/evil\nreport.json");
  assert.doesNotMatch(filename, /[\\/\u0000-\u001f]/);
  assert.doesNotMatch(filename, /^\./);
  assert.ok(filename.endsWith("report.json"));
});

test("empty and hostile analytics remain finite and bounded", () => {
  const workflow = validSupportTriageFixture();
  workflow.nodes = [];
  workflow.edges = [];
  workflow.scenarios = [];
  workflow.policies = [];
  const analytics = calculateWorkflowAnalytics(workflow, []);
  const values = [
    ...Object.values(analytics.structural),
    analytics.scenario.scenarioPassRate,
    analytics.scenario.expectedTerminalMatchRate,
    analytics.scenario.unresolvedDecisionRate,
    analytics.scenario.humanReviewCoverage,
    analytics.scenario.pathCoverage,
    analytics.scenario.nodeCoverage,
    analytics.scenario.edgeCoverage,
    ...Object.values(analytics.quality).map((score) => score.value),
  ];
  for (const value of values) {
    assert.equal(Number.isFinite(value), true);
    assert.ok(value >= 0 && value <= 100);
  }
});

test("simulation output is byte-deterministic over repeated runs", () => {
  const workflow = validSupportTriageFixture();
  const scenario = workflow.scenarios[2];
  const expected = JSON.stringify(simulateScenario(workflow, scenario));
  for (let iteration = 0; iteration < 20; iteration += 1) {
    assert.equal(JSON.stringify(simulateScenario(workflow, scenario)), expected);
  }
});
