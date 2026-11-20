import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import { validateAgentEvalRecords } from "./validate-context-agent-evals.mjs";

const script = fileURLToPath(new URL("./validate-context-agent-evals.mjs", import.meta.url));
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const revisionSha256 = sha256("validator test fixture revision");
const packId = `scp_${sha256("validator test pack").slice(0, 32)}`;

function measuredRecord(variant) {
  return {
    schema: "solvelang.context.agent-eval-record.v0",
    suiteId: "agent-eval-v1",
    pairId: "bug-fix-invoice-retry-claude-r1",
    fixture: {
      id: "bug-fix-invoice-retry",
      category: "monorepo-bug-fix",
      revisionSha256,
      handoffDirection: null,
    },
    agent: "claude",
    variant,
    provider: { name: "anthropic", model: "test-model" },
    recordClass: "measured-run",
    outcome: {
      taskSuccess: true,
      basis: "human-reviewed",
      evidenceRequired: 4,
      evidenceRetained: 4,
    },
    usage: {
      inputTokens: variant === "baseline" ? 1000 : 700,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      basis: "provider-reported",
      tokenizer: null,
    },
    latency: { wallMs: 5000, basis: "measured" },
    context: variant === "baseline"
      ? {
        packId: null,
        selectedBytes: null,
        cacheHotBytesChanged: null,
        cacheHotBytesChangedBasis: "unavailable",
        selectionPrecision: null,
        selectionRecall: null,
        selectionMetricsBasis: "unavailable",
      }
      : {
        packId,
        selectedBytes: 512,
        cacheHotBytesChanged: 0,
        cacheHotBytesChangedBasis: "measured",
        selectionPrecision: 1,
        selectionRecall: 1,
        selectionMetricsBasis: "measured",
      },
  };
}

function run(input) {
  return spawnSync(process.execPath, [script], {
    input,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

test("accepts a complete measured pair and reports it complete", () => {
  const result = run(JSON.stringify([measuredRecord("baseline"), measuredRecord("solve_context")]));
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, "solvelang.context.agent-eval-validation.v1");
  assert.equal(report.allValid, true);
  assert.equal(report.validCount, 2);
  assert.equal(report.invalidCount, 0);
  assert.deepEqual(report.pairs.complete, ["agent-eval-v1:bug-fix-invoice-retry-claude-r1"]);
  assert.deepEqual(report.pairs.incomplete, []);
  assert.equal(report.truth.providerRequestsPerformedByHarness, 0);
});

test("rejects the set when one record is malformed, naming the failing record", () => {
  const bad = measuredRecord("solve_context");
  delete bad.usage.outputTokens;
  const result = run(JSON.stringify([measuredRecord("baseline"), bad]));
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.allValid, false);
  assert.equal(report.validCount, 1);
  assert.equal(report.invalidCount, 1);
  assert.equal(report.records[1].valid, false);
  assert.match(report.records[1].error, /usage is missing outputTokens/);
});

test("flags a duplicated record instead of silently accepting the set", () => {
  const duplicate = measuredRecord("baseline");
  const result = run(JSON.stringify([duplicate, duplicate]));
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.invalidCount, 1);
  assert.match(report.records[1].error, /Duplicate agent eval record/);
});

test("reports an incomplete pair without invalidating its records", () => {
  const report = validateAgentEvalRecords([measuredRecord("baseline")]);
  assert.equal(report.allValid, true);
  assert.deepEqual(report.pairs.complete, []);
  assert.deepEqual(report.pairs.incomplete, [
    { pair: "agent-eval-v1:bug-fix-invoice-retry-claude-r1", hasBaseline: true, hasSolveContext: false },
  ]);
});

test("rejects non-array stdin instead of guessing a record shape", () => {
  const result = run(JSON.stringify(measuredRecord("baseline")));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be a JSON array/);
});
