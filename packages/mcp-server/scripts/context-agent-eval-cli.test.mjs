import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";

const script = fileURLToPath(new URL("./summarize-context-agent-evals.mjs", import.meta.url));
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const revisionSha256 = sha256("synthetic CLI fixture revision");
const packId = `scp_${sha256("synthetic CLI pack").slice(0, 32)}`;

function syntheticRecord(variant) {
  return {
    schema: "solvelang.context.agent-eval-record.v0",
    suiteId: "synthetic-cli-contract",
    pairId: "cli-pair-1",
    fixture: {
      id: "cli-contract-fixture",
      category: "github-issue-triage",
      revisionSha256,
    },
    agent: "codex",
    variant,
    provider: { name: "synthetic-provider", model: "synthetic-model" },
    recordClass: "synthetic-test",
    outcome: {
      taskSuccess: true,
      basis: "synthetic",
      evidenceRequired: 2,
      evidenceRetained: 2,
    },
    usage: {
      inputTokens: variant === "baseline" ? 100 : 80,
      outputTokens: 10,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      basis: "synthetic",
      tokenizer: "synthetic-fixture",
    },
    latency: {
      wallMs: variant === "baseline" ? 20 : 15,
      basis: "synthetic",
    },
    context: {
      packId: variant === "solve_context" ? packId : null,
      selectedBytes: variant === "solve_context" ? 512 : null,
      cacheHotBytesChanged: null,
      cacheHotBytesChangedBasis: "unavailable",
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

test("summarizes a bounded synthetic pair without promoting it to measured evidence", () => {
  const result = run(JSON.stringify([
    syntheticRecord("solve_context"),
    syntheticRecord("baseline"),
  ]));
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, "solvelang.context.agent-eval-report.v0");
  assert.equal(report.aggregate.pairCount, 1);
  assert.equal(report.aggregate.measuredPairCount, 0);
  assert.equal(report.aggregate.syntheticPairCount, 1);
  assert.equal(report.aggregate.providerTokenPairCount, 0);
  assert.equal(report.aggregate.measuredInputTokenDelta, null);
  assert.equal(report.aggregate.qualityGatePassed, null);
  assert.equal(report.aggregate.benchmarkEvidenceComplete, false);
  assert.equal(report.truth.providerRequestsPerformedByHarness, 0);
  assert.equal(report.truth.credentialsUsedByHarness, false);
  assert.equal(report.truth.publicPercentageClaimAllowed, false);
});

test("rejects non-array stdin instead of guessing a record shape", () => {
  const result = run(JSON.stringify(syntheticRecord("baseline")));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be a JSON array/);
});

test("rejects malformed paired records and emits no report", () => {
  const baseline = syntheticRecord("baseline");
  const context = syntheticRecord("solve_context");
  context.provider.model = "different-model";
  const result = run(JSON.stringify([baseline, context]));
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /provider\/model does not match/);
});
