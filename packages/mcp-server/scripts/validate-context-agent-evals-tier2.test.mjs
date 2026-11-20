import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildContextAgentEvalReport } from "../dist/src/context-agent-eval.js";
import { generateAgentEvalMatrix } from "./generate-agent-eval-matrix.mjs";
import { validateAgentEvalRecords } from "./validate-context-agent-evals.mjs";

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const packageFile = (relative) => new URL(`../${relative}`, import.meta.url);

async function loadJson(relative) {
  return JSON.parse(await readFile(packageFile(relative), "utf8"));
}

async function tier2Matrix() {
  const registry = await loadJson("benchmarks/agent-eval-fixtures-v2-tier2.json");
  const suites = {};
  for (const fixture of registry.fixtures) {
    if (!suites[fixture.sourceSuite]) suites[fixture.sourceSuite] = await loadJson(fixture.sourceSuite);
  }
  return generateAgentEvalMatrix(registry, suites);
}

// Fill a generated record template with concrete, non-regressing values so
// the strict record contract accepts it. These are synthetic test values in
// the exact shape of a measured run; they exist only inside this test
// process, are never written to disk as records, and are not evidence.
function fillTemplate(template) {
  const record = structuredClone(template);
  record.provider.model = "tier2-validator-test-model";
  record.outcome.taskSuccess = true;
  record.outcome.evidenceRetained = record.outcome.evidenceRequired;
  record.usage.inputTokens = record.variant === "baseline" ? 1000 : 700;
  record.usage.outputTokens = 100;
  record.usage.cacheReadTokens = 0;
  record.usage.cacheWriteTokens = 0;
  record.latency.wallMs = 5000;
  if (record.variant === "solve_context") {
    record.context.packId = `scp_${sha256(record.pairId).slice(0, 32)}`;
    record.context.selectedBytes = 512;
    record.context.cacheHotBytesChanged = 0;
    record.context.selectionPrecision = 1;
    record.context.selectionRecall = 1;
  }
  return record;
}

async function completeTier2Records() {
  const matrix = await tier2Matrix();
  return matrix.recordTemplates.map(fillTemplate);
}

test("accepts the complete Tier 2 record set and reports every pair complete", async () => {
  const records = await completeTier2Records();
  assert.equal(records.length, 180);
  const report = validateAgentEvalRecords(records);
  assert.equal(report.schema, "solvelang.context.agent-eval-validation.v1");
  assert.equal(report.allValid, true);
  assert.equal(report.validCount, 180);
  assert.equal(report.invalidCount, 0);
  assert.equal(report.pairs.complete.length, 90);
  assert.deepEqual(report.pairs.incomplete, []);
  assert.ok(report.pairs.complete.every((pair) => pair.startsWith("agent-eval-v2-tier2:")));
});

test("summarizes the complete Tier 2 set without completing benchmark evidence", async () => {
  const report = buildContextAgentEvalReport(await completeTier2Records());
  assert.equal(report.aggregate.pairCount, 90);
  assert.equal(report.aggregate.measuredPairCount, 90);
  assert.equal(report.aggregate.qualityGatePassed, true);
  assert.deepEqual(report.aggregate.qualityRegressionPairs, []);
  const byCategory = Object.fromEntries(report.coverage.categories.map((entry) => [entry.category, entry.measuredPairs]));
  assert.deepEqual(byCategory, {
    "monorepo-bug-fix": 0,
    "github-issue-triage": 18,
    "ci-log-diagnosis": 6,
    "multi-file-refactor": 60,
    "json-heavy-tool-output": 6,
    "cross-agent-handoff": 0,
  });
  // Tier 2 alone cannot complete benchmark evidence: it has no handoff
  // fixtures and no monorepo-bug-fix pairs, and publication stays
  // unauthorized regardless of what any summary computes.
  assert.equal(report.aggregate.benchmarkEvidenceComplete, false);
  assert.equal(report.truth.publicationAuthorized, false);
  assert.equal(report.truth.publicPercentageClaimAllowed, false);
});

test("rejects an incomplete Tier 2 pair set instead of summarizing it", async () => {
  const records = await completeTier2Records();
  const droppedPairId = "jsonld-escape-review-claude-r1";
  const incomplete = records.filter((record) => !(record.pairId === droppedPairId && record.variant === "solve_context"));
  assert.equal(incomplete.length, 179);
  const validation = validateAgentEvalRecords(incomplete);
  assert.equal(validation.allValid, true);
  assert.equal(validation.pairs.complete.length, 89);
  assert.deepEqual(validation.pairs.incomplete, [
    { pair: `agent-eval-v2-tier2:${droppedPairId}`, hasBaseline: true, hasSolveContext: false },
  ]);
  assert.throws(() => buildContextAgentEvalReport(incomplete), /is incomplete/);
});
