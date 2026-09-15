import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_AGENT_EVAL_RECORD_SCHEMA,
  buildContextAgentEvalReport,
} from "../src/context-agent-eval.js";
import { sha256Text } from "../src/context-pack.js";

const revision = sha256Text("pair-integrity-fixture");
const packId = `scp_${sha256Text("pair-integrity-pack").slice(0, 32)}`;

function record(variant: "baseline" | "solve_context"): any {
  return {
    schema: CONTEXT_AGENT_EVAL_RECORD_SCHEMA,
    suiteId: "pair-integrity-suite",
    pairId: "same-fixture-claude",
    fixture: {
      id: "same-fixture",
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
      cacheReadTokens: null,
      cacheWriteTokens: null,
      basis: "provider-reported",
      tokenizer: null,
    },
    latency: { wallMs: variant === "baseline" ? 2000 : 1700, basis: "measured" },
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
}

test("rejects pair arms that change the required evidence denominator", () => {
  const baseline = record("baseline");
  const context = record("solve_context");
  context.outcome.evidenceRequired = 1;
  context.outcome.evidenceRetained = 1;

  assert.throws(
    () => buildContextAgentEvalReport([baseline, context]),
    /required evidence count does not match/,
  );
});

test("rejects pair arms evaluated with different outcome bases", () => {
  const baseline = record("baseline");
  const context = record("solve_context");
  context.outcome.basis = "human-reviewed";

  assert.throws(
    () => buildContextAgentEvalReport([baseline, context]),
    /outcome basis does not match/,
  );
});
