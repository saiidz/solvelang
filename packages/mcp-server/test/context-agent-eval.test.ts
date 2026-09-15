import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_AGENT_EVAL_CATEGORIES,
  CONTEXT_AGENT_EVAL_RECORD_SCHEMA,
  buildContextAgentEvalReport,
  validateContextAgentEvalRecord,
} from "../src/context-agent-eval.js";
import { sha256Text } from "../src/context-pack.js";

const revision = sha256Text("fixture revision");
const packId = `scp_${sha256Text("pack").slice(0, 32)}`;

function record(variant: "baseline" | "solve_context", overrides: Record<string, unknown> = {}): any {
  const base = {
    schema: CONTEXT_AGENT_EVAL_RECORD_SCHEMA,
    suiteId: "suite-2026-09",
    pairId: "invoice-retry-claude-1",
    fixture: {
      id: "invoice-retry",
      category: "monorepo-bug-fix",
      revisionSha256: revision,
      handoffDirection: null,
    },
    agent: "claude",
    variant,
    provider: { name: "anthropic", model: "claude-example" },
    recordClass: "measured-run",
    outcome: {
      taskSuccess: true,
      basis: "deterministic-check",
      evidenceRequired: 4,
      evidenceRetained: 4,
    },
    usage: {
      inputTokens: variant === "baseline" ? 1000 : 700,
      outputTokens: 100,
      cacheReadTokens: variant === "baseline" ? 400 : 450,
      cacheWriteTokens: 0,
      basis: "provider-reported",
      tokenizer: null,
    },
    latency: {
      wallMs: variant === "baseline" ? 2000 : 1700,
      basis: "measured",
    },
    context: {
      packId: variant === "solve_context" ? packId : null,
      selectedBytes: variant === "solve_context" ? 4096 : null,
      cacheHotBytesChanged: variant === "solve_context" ? 0 : null,
      cacheHotBytesChangedBasis: variant === "solve_context" ? "measured" : "unavailable",
      selectionPrecision: variant === "solve_context" ? 1 : null,
      selectionRecall: variant === "solve_context" ? 1 : null,
      selectionMetricsBasis: variant === "solve_context" ? "measured" : "unavailable",
    },
  };
  return { ...base, ...overrides };
}

function measuredPair(
  id: string,
  category: string,
  agent: "claude" | "codex",
  handoffDirection: "claude-to-codex" | "codex-to-claude" | null = null,
): any[] {
  const fixture = {
    id,
    category,
    revisionSha256: sha256Text(`fixture:${id}`),
    handoffDirection,
  };
  const pairId = `${id}-${agent}`;
  const baseline = record("baseline");
  const context = record("solve_context");
  for (const value of [baseline, context]) {
    value.suiteId = "complete-suite";
    value.pairId = pairId;
    value.fixture = fixture;
    value.agent = agent;
    value.provider = { name: agent === "claude" ? "anthropic" : "openai", model: `${agent}-fixture-model` };
  }
  return [baseline, context];
}

function completeMeasuredSuite(): any[] {
  return [
    ...measuredPair("bug-fix", "monorepo-bug-fix", "claude"),
    ...measuredPair("issue-triage", "github-issue-triage", "codex"),
    ...measuredPair("ci-diagnosis", "ci-log-diagnosis", "claude"),
    ...measuredPair("refactor", "multi-file-refactor", "codex"),
    ...measuredPair("json-output", "json-heavy-tool-output", "claude"),
    ...measuredPair("handoff-c2c", "cross-agent-handoff", "codex", "claude-to-codex"),
    ...measuredPair("handoff-c2a", "cross-agent-handoff", "claude", "codex-to-claude"),
  ];
}

test("validates a measured pair record and produces a stable identity", () => {
  const first = validateContextAgentEvalRecord(record("baseline"));
  const second = validateContextAgentEvalRecord(record("baseline"));
  assert.equal(first.recordSha256, second.recordSha256);
  assert.match(first.recordSha256, /^[a-f0-9]{64}$/);
});

test("rejects synthetic evidence hidden inside a measured run", () => {
  const value = record("baseline");
  value.outcome.basis = "synthetic";
  assert.throws(() => validateContextAgentEvalRecord(value), /Measured runs cannot contain synthetic evidence bases/);
});

test("rejects local tokenizer counts that claim provider cache tokens", () => {
  const value = record("baseline");
  value.usage = {
    inputTokens: 900,
    outputTokens: 90,
    cacheReadTokens: 10,
    cacheWriteTokens: null,
    basis: "local-tokenizer",
    tokenizer: "o200k_base",
  };
  assert.throws(() => validateContextAgentEvalRecord(value), /cannot claim provider cache tokens/);
});

test("rejects baseline records that claim Solve Context pack or selection evidence", () => {
  const packed = record("baseline");
  packed.context.packId = packId;
  packed.context.selectedBytes = 123;
  assert.throws(() => validateContextAgentEvalRecord(packed), /Baseline records cannot claim a Solve Context pack/);

  const selected = record("baseline");
  selected.context.selectionPrecision = 1;
  selected.context.selectionRecall = 1;
  selected.context.selectionMetricsBasis = "measured";
  assert.throws(() => validateContextAgentEvalRecord(selected), /Baseline records cannot claim Solve Context selection metrics/);
});

test("requires an explicit direction only for cross-agent handoff fixtures", () => {
  const missing = record("baseline");
  missing.fixture.category = "cross-agent-handoff";
  assert.throws(() => validateContextAgentEvalRecord(missing), /require an explicit handoffDirection/);

  const invalid = record("baseline");
  invalid.fixture.handoffDirection = "claude-to-codex";
  assert.throws(() => validateContextAgentEvalRecord(invalid), /Only cross-agent handoff fixtures may set handoffDirection/);
});

test("reports provider token, latency, selection, evidence, and cache-hot measurements without authorizing a claim", () => {
  const report = buildContextAgentEvalReport([record("solve_context"), record("baseline")]);
  assert.equal(report.aggregate.pairCount, 1);
  assert.equal(report.aggregate.measuredPairCount, 1);
  assert.equal(report.aggregate.syntheticPairCount, 0);
  assert.equal(report.aggregate.qualityGatePassed, true);
  assert.equal(report.aggregate.providerTokenPairCount, 1);
  assert.equal(report.aggregate.measuredBaselineInputTokens, 1000);
  assert.equal(report.aggregate.measuredContextInputTokens, 700);
  assert.equal(report.aggregate.measuredInputTokenDelta, -300);
  assert.equal(report.aggregate.measuredInputTokenDeltaPercent, -30);
  assert.equal(report.aggregate.measuredLatencyPairCount, 1);
  assert.equal(report.aggregate.meanWallDeltaMs, -300);
  assert.equal(report.aggregate.measuredSelectionMetricPairCount, 1);
  assert.equal(report.aggregate.measuredZeroCacheHotMutationPairCount, 1);
  assert.equal(report.aggregate.benchmarkEvidenceComplete, false);
  assert.equal(report.truth.providerRequestsPerformedByHarness, 0);
  assert.equal(report.truth.credentialsUsedByHarness, false);
  assert.equal(report.truth.publicationAuthorized, false);
  assert.equal(report.truth.publicPercentageClaimAllowed, false);
  assert.deepEqual(report.coverage.missingCategories, CONTEXT_AGENT_EVAL_CATEGORIES.slice(1));
  assert.equal(report.coverage.bidirectionalHandoffCoverageComplete, false);
  assert.equal(report.pairs[0].providerTokens.comparable, true);
  assert.equal(report.pairs[0].localTokenizer.comparable, false);
  assert.equal(report.pairs[0].estimatedTokens.comparable, false);
  assert.equal(report.pairs[0].fidelity.measuredZeroCacheHotMutation, true);
  assert.equal(report.pairs[0].context.measuredSelectionMetrics, true);
  assert.equal(report.pairs[0].context.selectionPrecision, 1);
  assert.equal(report.pairs[0].context.selectionRecall, 1);
});

test("surfaces quality regression instead of hiding token reduction", () => {
  const context = record("solve_context");
  context.outcome.taskSuccess = false;
  context.outcome.evidenceRetained = 2;
  context.usage.inputTokens = 300;
  const report = buildContextAgentEvalReport([record("baseline"), context]);
  assert.equal(report.aggregate.measuredInputTokenDelta, -700);
  assert.equal(report.aggregate.qualityGatePassed, false);
  assert.deepEqual(report.aggregate.qualityRegressionPairs, ["suite-2026-09:invoice-retry-claude-1"]);
  assert.equal(report.pairs[0].quality.nonRegression, false);
  assert.equal(report.aggregate.benchmarkEvidenceComplete, false);
});

test("keeps local tokenizer and estimated counts separate from provider-reported tokens", () => {
  const baseline = record("baseline");
  const context = record("solve_context");
  baseline.usage = { inputTokens: 900, outputTokens: 90, cacheReadTokens: null, cacheWriteTokens: null, basis: "local-tokenizer", tokenizer: "o200k_base" };
  context.usage = { inputTokens: 600, outputTokens: 90, cacheReadTokens: null, cacheWriteTokens: null, basis: "local-tokenizer", tokenizer: "o200k_base" };
  const localReport = buildContextAgentEvalReport([baseline, context]);
  assert.equal(localReport.aggregate.providerTokenPairCount, 0);
  assert.equal(localReport.aggregate.measuredInputTokenDelta, null);
  assert.equal(localReport.pairs[0].localTokenizer.comparable, true);
  assert.equal(localReport.pairs[0].localTokenizer.inputDelta, -300);

  baseline.usage = { inputTokens: 880, outputTokens: 85, cacheReadTokens: null, cacheWriteTokens: null, basis: "estimated", tokenizer: "chars-div-4-v1" };
  context.usage = { inputTokens: 580, outputTokens: 85, cacheReadTokens: null, cacheWriteTokens: null, basis: "estimated", tokenizer: "chars-div-4-v1" };
  const estimatedReport = buildContextAgentEvalReport([baseline, context]);
  assert.equal(estimatedReport.aggregate.providerTokenPairCount, 0);
  assert.equal(estimatedReport.pairs[0].estimatedTokens.comparable, true);
  assert.equal(estimatedReport.pairs[0].estimatedTokens.inputDelta, -300);
  assert.equal(estimatedReport.truth.estimatedTokensAreNotProviderTokens, true);
});

test("excludes synthetic fixture pairs from measured aggregates", () => {
  const baseline = record("baseline");
  const context = record("solve_context");
  for (const value of [baseline, context]) {
    value.recordClass = "synthetic-test";
    value.outcome.basis = "synthetic";
    value.usage = { inputTokens: 100, outputTokens: 10, cacheReadTokens: null, cacheWriteTokens: null, basis: "synthetic", tokenizer: "synthetic-fixture" };
    value.latency = { wallMs: 1, basis: "synthetic" };
    value.context.cacheHotBytesChanged = null;
    value.context.cacheHotBytesChangedBasis = "unavailable";
    value.context.selectionPrecision = value.variant === "solve_context" ? 1 : null;
    value.context.selectionRecall = value.variant === "solve_context" ? 1 : null;
    value.context.selectionMetricsBasis = value.variant === "solve_context" ? "synthetic" : "unavailable";
  }
  const report = buildContextAgentEvalReport([baseline, context]);
  assert.equal(report.aggregate.measuredPairCount, 0);
  assert.equal(report.aggregate.syntheticPairCount, 1);
  assert.equal(report.aggregate.qualityGatePassed, null);
  assert.equal(report.aggregate.providerTokenPairCount, 0);
  assert.equal(report.aggregate.measuredSelectionMetricPairCount, 0);
  assert.equal(report.aggregate.measuredInputTokenDelta, null);
  assert.equal(report.truth.syntheticRecordsExcludedFromMeasuredAggregates, true);
});

test("requires every #898 acceptance condition before benchmark evidence is complete", () => {
  const records = completeMeasuredSuite();
  const complete = buildContextAgentEvalReport(records);
  assert.equal(complete.coverage.acceptanceCategoryCoverageComplete, true);
  assert.equal(complete.coverage.bidirectionalHandoffCoverageComplete, true);
  assert.deepEqual(complete.coverage.agents, [
    { agent: "claude", measuredPairs: 4 },
    { agent: "codex", measuredPairs: 3 },
  ]);
  assert.equal(complete.aggregate.measuredPairCount, 7);
  assert.equal(complete.aggregate.providerTokenPairCount, 7);
  assert.equal(complete.aggregate.measuredLatencyPairCount, 7);
  assert.equal(complete.aggregate.measuredSelectionMetricPairCount, 7);
  assert.equal(complete.aggregate.measuredZeroCacheHotMutationPairCount, 7);
  assert.equal(complete.aggregate.qualityGatePassed, true);
  assert.equal(complete.aggregate.benchmarkEvidenceComplete, true);
  assert.equal(complete.truth.publicPercentageClaimAllowed, false);

  const missingDirection = structuredClone(records).filter((value: any) => value.pairId !== "handoff-c2a-claude");
  assert.equal(buildContextAgentEvalReport(missingDirection).coverage.bidirectionalHandoffCoverageComplete, false);
  assert.equal(buildContextAgentEvalReport(missingDirection).aggregate.benchmarkEvidenceComplete, false);

  const missingSelection = structuredClone(records);
  const contextWithoutSelection = missingSelection.find((value: any) => value.variant === "solve_context" && value.pairId === "bug-fix-claude");
  contextWithoutSelection.context.selectionPrecision = null;
  contextWithoutSelection.context.selectionRecall = null;
  contextWithoutSelection.context.selectionMetricsBasis = "unavailable";
  assert.equal(buildContextAgentEvalReport(missingSelection).aggregate.measuredSelectionMetricPairCount, 6);
  assert.equal(buildContextAgentEvalReport(missingSelection).aggregate.benchmarkEvidenceComplete, false);

  const hotMutation = structuredClone(records);
  const mutatedContext = hotMutation.find((value: any) => value.variant === "solve_context" && value.pairId === "issue-triage-codex");
  mutatedContext.context.cacheHotBytesChanged = 1;
  assert.equal(buildContextAgentEvalReport(hotMutation).aggregate.measuredZeroCacheHotMutationPairCount, 6);
  assert.equal(buildContextAgentEvalReport(hotMutation).aggregate.benchmarkEvidenceComplete, false);
});

test("rejects incomplete and mismatched baseline/context pairs", () => {
  assert.throws(() => buildContextAgentEvalReport([record("baseline")]), /is incomplete/);

  const context = record("solve_context");
  context.provider = { name: "anthropic", model: "different-model" };
  assert.throws(() => buildContextAgentEvalReport([record("baseline"), context]), /provider\/model does not match/);
});

test("report identity and ordering are deterministic regardless of input order", () => {
  const baseline = record("baseline");
  const context = record("solve_context");
  const forward = buildContextAgentEvalReport([baseline, context]);
  const reverse = buildContextAgentEvalReport([context, baseline]);
  assert.equal(forward.reportId, reverse.reportId);
  assert.deepEqual(forward, reverse);
});
