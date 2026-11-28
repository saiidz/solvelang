import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildContextAgentEvalReport } from "../dist/src/context-agent-eval.js";
import { renderAgentEvalSummary } from "./render-agent-eval-summary.mjs";

const script = fileURLToPath(new URL("./render-agent-eval-summary.mjs", import.meta.url));
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const revisionSha256 = sha256("renderer test fixture revision");
const packId = `scp_${sha256("renderer test pack").slice(0, 32)}`;

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
      outputTokens: variant === "baseline" ? 120 : 90,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      basis: "provider-reported",
      tokenizer: null,
    },
    latency: { wallMs: variant === "baseline" ? 5000 : 4200, basis: "measured" },
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

test("renders gates, aggregates, and coverage from report fields only", () => {
  const report = buildContextAgentEvalReport([measuredRecord("baseline"), measuredRecord("solve_context")]);
  const markdown = renderAgentEvalSummary(report);
  assert.match(markdown, /Not authorized for publication/);
  assert.match(markdown, /Benchmark evidence complete \| no \|/);
  assert.match(markdown, /Provider input tokens \(total, 1 pairs\) \| 1000 \| 700 \| -300 \(-30%\)/);
  assert.match(markdown, /Provider output tokens \(total, summed over comparable pairs\) \| 120 \| 90 \| -30 \|/);
  assert.match(markdown, /Mean wall latency \(1 pairs\) \| 5000 ms \| 4200 ms \| -800 ms \|/);
  assert.match(markdown, /\| monorepo-bug-fix \| 1 \|/);
  assert.match(markdown, /\| claude \| 1 \|/);
  assert.match(markdown, /None recorded among measured pairs/);
});

test("renders quality regressions by pair identity when the gate fails", () => {
  const context = measuredRecord("solve_context");
  context.outcome.taskSuccess = false;
  const report = buildContextAgentEvalReport([measuredRecord("baseline"), context]);
  assert.equal(report.aggregate.qualityGatePassed, false);
  const markdown = renderAgentEvalSummary(report);
  assert.match(markdown, /Quality gate \(no measured regression\) \| no \|/);
  assert.match(markdown, /- agent-eval-v1:bug-fix-invoice-retry-claude-r1/);
});

test("refuses input that is not an agent-eval report", () => {
  assert.throws(() => renderAgentEvalSummary([measuredRecord("baseline")]), /must be a report object/);
  assert.throws(() => renderAgentEvalSummary({ schema: "something-else" }), /not an agent-eval report/);
  const result = run(JSON.stringify({ schema: "something-else" }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not an agent-eval report/);
});

test("renders through the CLI from stdin", () => {
  const report = buildContextAgentEvalReport([measuredRecord("baseline"), measuredRecord("solve_context")]);
  const result = run(JSON.stringify(report));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Solve Context agent-eval summary/);
  assert.match(result.stdout, new RegExp(report.reportId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

function syntheticRecord(variant) {
  return {
    schema: "solvelang.context.agent-eval-record.v0",
    suiteId: "synthetic-renderer-contract",
    pairId: "renderer-synthetic-pair-1",
    fixture: {
      id: "renderer-synthetic-fixture",
      category: "github-issue-triage",
      revisionSha256,
      handoffDirection: null,
    },
    agent: "codex",
    variant,
    provider: { name: "synthetic-provider", model: "synthetic-model" },
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
      : { packId, selectedBytes: 512, cacheHotBytesChanged: null, cacheHotBytesChangedBasis: "unavailable", selectionPrecision: 1, selectionRecall: 1, selectionMetricsBasis: "synthetic" },
  };
}

test("renders a Task success section with per-agent and all-agents pass counts for measured pairs", () => {
  const report = buildContextAgentEvalReport([measuredRecord("baseline"), measuredRecord("solve_context")]);
  const markdown = renderAgentEvalSummary(report);
  const sectionStart = markdown.indexOf("## Task success");
  assert.ok(sectionStart > markdown.indexOf("## Measured aggregates"), "Task success follows Measured aggregates");
  assert.ok(sectionStart < markdown.indexOf("## Coverage"), "Task success precedes Coverage");
  const section = markdown.slice(sectionStart, markdown.indexOf("## Coverage"));
  assert.match(section, /\| Agent \| Baseline pass \| Solve Context pass \|/);
  assert.match(section, /\| claude \| 1 of 1 \| 1 of 1 \|/);
  assert.match(section, /\| all agents \| 1 of 1 \| 1 of 1 \|/);
});

test("Task success section says plainly when there are no measured pairs instead of printing zeros", () => {
  const report = buildContextAgentEvalReport([syntheticRecord("baseline"), syntheticRecord("solve_context")]);
  assert.equal(report.aggregate.measuredPairCount, 0);
  const markdown = renderAgentEvalSummary(report);
  const section = markdown.slice(markdown.indexOf("## Task success"), markdown.indexOf("## Coverage"));
  assert.match(section, /No measured pairs in this report/);
  assert.doesNotMatch(section, /0 of 0/);
  assert.doesNotMatch(section, /\| all agents \|/);
});
