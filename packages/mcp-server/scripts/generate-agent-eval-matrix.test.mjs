import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  evidenceRequiredCount,
  fixtureRevisionSha256,
  generateAgentEvalMatrix,
} from "./generate-agent-eval-matrix.mjs";

const script = fileURLToPath(new URL("./generate-agent-eval-matrix.mjs", import.meta.url));

function runGenerator() {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

test("generates the full Tier 1 matrix from the checked-in registry", () => {
  const result = runGenerator();
  assert.equal(result.status, 0, result.stderr);
  const matrix = JSON.parse(result.stdout);
  assert.equal(matrix.schema, "solvelang.context.agent-eval-matrix.v1");
  assert.equal(matrix.suiteId, "agent-eval-v1");
  // 5 two-agent fixtures x 2 agents x 3 reps + 2 single-agent handoff fixtures x 3 reps.
  assert.equal(matrix.pairCount, 36);
  assert.equal(matrix.recordCount, 72);
  assert.equal(matrix.cells.length, 36);
  assert.equal(matrix.recordTemplates.length, 72);
  assert.equal(matrix.runLogTemplates.length, 36);
  assert.equal(new Set(matrix.cells.map((cell) => cell.pairId)).size, 36);
});

test("emits record templates with the exact contract key structure and pinned identities", () => {
  const matrix = JSON.parse(runGenerator().stdout);
  const expectedKeys = ["schema", "suiteId", "pairId", "fixture", "agent", "variant", "provider", "recordClass", "outcome", "usage", "latency", "context"];
  for (const template of matrix.recordTemplates) {
    assert.deepEqual(Object.keys(template), expectedKeys);
    assert.equal(template.schema, "solvelang.context.agent-eval-record.v0");
    assert.equal(template.recordClass, "measured-run");
    assert.match(template.fixture.revisionSha256, /^[a-f0-9]{64}$/);
    if (template.variant === "baseline") {
      assert.equal(template.context.selectionMetricsBasis, "unavailable");
      assert.equal(template.context.packId, null);
    } else {
      assert.equal(template.context.selectionMetricsBasis, "measured");
      assert.equal(template.context.cacheHotBytesChangedBasis, "measured");
    }
  }
  const invoice = matrix.recordTemplates.find((template) => template.pairId === "bug-fix-invoice-retry-claude-r1" && template.variant === "baseline");
  assert.equal(invoice.fixture.category, "monorepo-bug-fix");
  assert.equal(invoice.outcome.evidenceRequired, 4);
  assert.equal(invoice.outcome.basis, "human-reviewed");
});

test("alternates arm order by repetition and pins both handoff directions", () => {
  const matrix = JSON.parse(runGenerator().stdout);
  const cell = (pairId) => matrix.cells.find((entry) => entry.pairId === pairId);
  assert.deepEqual(cell("bug-fix-invoice-retry-claude-r1").armOrder, ["baseline", "solve_context"]);
  assert.deepEqual(cell("bug-fix-invoice-retry-claude-r2").armOrder, ["solve_context", "baseline"]);
  assert.deepEqual(cell("bug-fix-invoice-retry-claude-r3").armOrder, ["baseline", "solve_context"]);
  assert.equal(cell("handoff-claude-to-codex-claude-r1").handoffDirection, "claude-to-codex");
  assert.equal(cell("handoff-codex-to-claude-codex-r1").handoffDirection, "codex-to-claude");
  assert.equal(cell("handoff-claude-to-codex-codex-r1"), undefined);
  assert.match(matrix.checklist, /bug-fix-invoice-retry-claude-r1/);
  assert.match(matrix.checklist, /Do not coach the agent/);
});

test("derives fixture identity and evidence counts from the source case, not the registry", () => {
  const suiteCase = {
    id: "case-1",
    task: "do the thing",
    budgetBytes: 4096,
    requiredEvidence: { "a.js": ["x", "y"], "b.js": ["z"] },
    sources: [],
  };
  assert.equal(evidenceRequiredCount(suiteCase), 3);
  assert.match(fixtureRevisionSha256(suiteCase), /^[a-f0-9]{64}$/);
  const reordered = { sources: [], requiredEvidence: { "b.js": ["z"], "a.js": ["x", "y"] }, budgetBytes: 4096, task: "do the thing", id: "case-1" };
  assert.equal(fixtureRevisionSha256(reordered), fixtureRevisionSha256(suiteCase));
});

test("fails closed on a registry that drifts from the contract or the suites", () => {
  const suite = { cases: [{ id: "case-1", budgetBytes: 4096, requiredEvidence: { "a.js": ["x"] }, sources: [] }] };
  const base = {
    schema: "solvelang.context.agent-eval-fixtures.v1",
    suiteId: "agent-eval-v1",
    repsPerCell: 1,
    outcomeBasis: "human-reviewed",
    providers: { claude: { name: "anthropic" }, codex: { name: "openai" } },
    fixtures: [{
      fixtureId: "f1",
      sourceSuite: "benchmarks/context-v0.json",
      sourceCaseId: "case-1",
      category: "monorepo-bug-fix",
      handoffDirection: null,
      agents: ["claude"],
    }],
  };
  const suites = { "benchmarks/context-v0.json": suite };
  assert.equal(generateAgentEvalMatrix(base, suites).pairCount, 1);
  const badCategory = structuredClone(base);
  badCategory.fixtures[0].category = "not-a-category";
  assert.throws(() => generateAgentEvalMatrix(badCategory, suites), /not a record-contract category/);
  const missingCase = structuredClone(base);
  missingCase.fixtures[0].sourceCaseId = "absent";
  assert.throws(() => generateAgentEvalMatrix(missingCase, suites), /absent from/);
  const directionless = structuredClone(base);
  directionless.fixtures[0].category = "cross-agent-handoff";
  assert.throws(() => generateAgentEvalMatrix(directionless, suites), /requires a handoff direction/);
});
