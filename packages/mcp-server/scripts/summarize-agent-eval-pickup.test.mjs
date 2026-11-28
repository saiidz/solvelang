import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// All values in this file are synthetic / illustrative test data, not benchmark evidence.
// They are chosen only so pass counts and the token delta are exactly assertable.
const script = fileURLToPath(new URL("./summarize-agent-eval-pickup.mjs", import.meta.url));
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const packIdFor = (seed) => `scp_${sha256(seed).slice(0, 32)}`;

// Fixture ids/categories shaped after benchmarks/agent-eval-fixtures-v1.json.
const FIXTURES = [
  { id: "bug-fix-invoice-retry", category: "monorepo-bug-fix" },
  { id: "github-issue-session-refresh", category: "github-issue-triage" },
  { id: "ci-payment-webhook", category: "ci-log-diagnosis" },
];

function baseRecord(fixture, variant) {
  return {
    schema: "solvelang.context.agent-eval-record.v0",
    suiteId: "agent-eval-v1",
    pairId: `${fixture.id}-codex-r1`,
    fixture: {
      id: fixture.id,
      category: fixture.category,
      revisionSha256: sha256(`pickup test fixture revision ${fixture.id}`),
      handoffDirection: null,
    },
    agent: "codex",
    variant,
    provider: { name: "openai", model: "pickup-test-model" },
  };
}

function syntheticRecord(fixture, variant) {
  return {
    ...baseRecord(fixture, variant),
    recordClass: "synthetic-test",
    outcome: { taskSuccess: true, basis: "synthetic", evidenceRequired: 2, evidenceRetained: 2 },
    usage: {
      inputTokens: variant === "baseline" ? 100 : 80,
      outputTokens: 10,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      basis: "synthetic",
      tokenizer: "synthetic-fixture",
    },
    latency: { wallMs: variant === "baseline" ? 20 : 15, basis: "synthetic" },
    context: variant === "baseline"
      ? { packId: null, selectedBytes: null, cacheHotBytesChanged: null, cacheHotBytesChangedBasis: "unavailable", selectionPrecision: null, selectionRecall: null, selectionMetricsBasis: "unavailable" }
      : { packId: packIdFor(`synthetic pickup pack ${fixture.id}`), selectedBytes: 512, cacheHotBytesChanged: null, cacheHotBytesChangedBasis: "unavailable", selectionPrecision: 1, selectionRecall: 1, selectionMetricsBasis: "synthetic" },
  };
}

function measuredRecord(fixture, variant, { taskSuccess, inputTokens }) {
  return {
    ...baseRecord(fixture, variant),
    recordClass: "measured-run",
    outcome: { taskSuccess, basis: "deterministic-check", evidenceRequired: 2, evidenceRetained: 2 },
    usage: {
      inputTokens,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      basis: "provider-reported",
      tokenizer: null,
    },
    latency: { wallMs: variant === "baseline" ? 1000 : 900, basis: "measured" },
    context: variant === "baseline"
      ? { packId: null, selectedBytes: null, cacheHotBytesChanged: null, cacheHotBytesChangedBasis: "unavailable", selectionPrecision: null, selectionRecall: null, selectionMetricsBasis: "unavailable" }
      : { packId: packIdFor(`measured pickup pack ${fixture.id}`), selectedBytes: 512, cacheHotBytesChanged: 0, cacheHotBytesChangedBasis: "measured", selectionPrecision: 1, selectionRecall: 1, selectionMetricsBasis: "measured" },
  };
}

function runPickup(records) {
  const dir = mkdtempSync(path.join(tmpdir(), "agent-eval-pickup-test-"));
  const recordsFile = path.join(dir, "records.json");
  const outputDir = path.join(dir, "out", "nested");
  writeFileSync(recordsFile, JSON.stringify(records), "utf8");
  const result = spawnSync(process.execPath, [script, recordsFile, outputDir], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return { result, outputDir, reportFile: path.join(outputDir, "agent-eval-report.json"), summaryFile: path.join(outputDir, "agent-eval-summary.md") };
}

test("synthetic-test pickup runs, stays out of measured aggregates, and renders the report truth block", () => {
  const fixture = FIXTURES[0];
  const { result, reportFile, summaryFile } = runPickup([syntheticRecord(fixture, "baseline"), syntheticRecord(fixture, "solve_context")]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /agent-eval-report:/);
  assert.match(result.stdout, /agent-eval-summary:/);
  assert.match(result.stdout, /Pairs: 1 \(measured 0 · synthetic 1\)/);
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  assert.ok(report.aggregate.syntheticPairCount > 0);
  assert.equal(report.aggregate.measuredPairCount, 0);
  assert.equal(report.aggregate.measuredInputTokenDeltaPercent, null);
  assert.equal(report.truth.publicationAuthorized, false);
  assert.equal(report.truth.publicPercentageClaimAllowed, false);
  const summary = readFileSync(summaryFile, "utf8");
  assert.match(summary, /Not authorized for publication/);
  assert.match(summary, /## Task success/);
  assert.match(summary, /No measured pairs in this report/);
});

test("measured-run-shaped pickup recomputes pass counts and token delta exactly", () => {
  // Illustrative test values only (not benchmark evidence): 3 pairs, pass 2/3 vs 2/3,
  // baseline input 1000 per pair (3000 total) vs context 560 per pair (1680 total) = -44.0%.
  const specs = [
    { fixture: FIXTURES[0], baselineSuccess: true, contextSuccess: true },
    { fixture: FIXTURES[1], baselineSuccess: true, contextSuccess: false },
    { fixture: FIXTURES[2], baselineSuccess: false, contextSuccess: true },
  ];
  const records = [];
  for (const spec of specs) {
    records.push(measuredRecord(spec.fixture, "baseline", { taskSuccess: spec.baselineSuccess, inputTokens: 1000 }));
    records.push(measuredRecord(spec.fixture, "solve_context", { taskSuccess: spec.contextSuccess, inputTokens: 560 }));
  }
  const { result, reportFile, summaryFile } = runPickup(records);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Pairs: 3 \(measured 3 · synthetic 0\)/);
  assert.match(result.stdout, /codex: baseline 2 of 3 · Solve Context 2 of 3/);
  assert.match(result.stdout, /Provider input-token delta: -44%/);
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  assert.equal(report.aggregate.measuredPairCount, 3);
  assert.equal(report.aggregate.measuredBaselineInputTokens, 3000);
  assert.equal(report.aggregate.measuredContextInputTokens, 1680);
  assert.equal(report.aggregate.measuredInputTokenDelta, -1320);
  assert.equal(report.aggregate.measuredInputTokenDeltaPercent, -44);
  const summary = readFileSync(summaryFile, "utf8");
  const section = summary.slice(summary.indexOf("## Task success"), summary.indexOf("## Coverage"));
  assert.match(section, /\| codex \| 2 of 3 \| 2 of 3 \|/);
  assert.match(section, /\| all agents \| 2 of 3 \| 2 of 3 \|/);
});

test("pickup fails closed on the first invalid record, naming its index, and writes no artifacts", () => {
  const fixture = FIXTURES[0];
  const bad = syntheticRecord(fixture, "solve_context");
  bad.provider = { name: "openai" };
  const { result, reportFile, summaryFile } = runPickup([syntheticRecord(fixture, "baseline"), bad]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /index 1/);
  assert.equal(existsSync(reportFile), false);
  assert.equal(existsSync(summaryFile), false);
});
