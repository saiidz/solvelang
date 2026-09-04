import assert from "node:assert/strict";
import test from "node:test";
import { analyzeAiContext } from "./selfDrivingAiScout";
import { createSolveContextSnapshot, type SolveContextSignalInput, type SolveContextSnapshot } from "./selfDrivingContext";

function aiTrace(overrides: Partial<SolveContextSignalInput> = {}): SolveContextSignalInput {
  return {
    kind: "ai-trace",
    source: "fixture-ai-traces",
    locator: "ai-trace:sanitized-42",
    observedAt: "2026-09-02T16:00:00Z",
    summary: "Sanitized AI trace summary.",
    dimensions: {
      outcome: "success",
      model_family: "reasoning-model",
    },
    metrics: {
      latency_ms: 1200,
      input_tokens: 1000,
      output_tokens: 250,
      total_tokens: 1250,
      cost_usd: 0.04,
    },
    sanitized: true,
    ...overrides,
  };
}

function mcpCall(overrides: Partial<SolveContextSignalInput> = {}): SolveContextSignalInput {
  return {
    kind: "mcp-tool-call",
    source: "fixture-mcp-traces",
    locator: "mcp:catalog.lookup:sanitized-42",
    observedAt: "2026-09-02T16:01:00Z",
    summary: "Sanitized MCP tool-call summary.",
    dimensions: {
      outcome: "failure",
      tool: "catalog.lookup",
    },
    metrics: {
      attempts: 4,
      latency_ms: 4200,
      cost_usd: 0.02,
    },
    sanitized: true,
    ...overrides,
  };
}

test("AI Scout reports an explicit failed AI trace without inferring a cause", () => {
  const context = createSolveContextSnapshot([
    aiTrace({ dimensions: { outcome: "failure", model_family: "reasoning-model" } }),
  ]);
  const analysis = analyzeAiContext(context);

  assert.equal(analysis.schema, "solvelang.self-driving.ai-scout.v0");
  assert.equal(analysis.mode, "analyze-only");
  assert.equal(analysis.execution.status, "complete");
  assert.equal(analysis.execution.examinedSignals, 1);
  assert.equal(analysis.execution.candidateFindings, 1);
  assert.equal(analysis.inbox.items.length, 1);
  assert.equal(analysis.inbox.items[0].scout, "ai");
  assert.equal(analysis.inbox.items[0].title, "AI trace reported an explicit failure");
  assert.match(analysis.inbox.items[0].summary, /without inferring a root cause/);
  assert.deepEqual(analysis.inbox.items[0].recommendedAction, {
    kind: "inspect",
    label: "Inspect failed AI trace",
  });
  assert.equal(analysis.inbox.items[0].provenance[0].kind, "ai-trace");
});

test("AI Scout does not invent latency, token, or cost findings when no budgets are supplied", () => {
  const context = createSolveContextSnapshot([
    aiTrace({
      metrics: {
        latency_ms: 999999,
        input_tokens: 999999,
        output_tokens: 999999,
        total_tokens: 1999998,
        cost_usd: 999999,
      },
    }),
  ]);
  const analysis = analyzeAiContext(context);

  assert.deepEqual(analysis.budgets, {});
  assert.equal(analysis.execution.candidateFindings, 0);
  assert.equal(analysis.inbox.items.length, 0);
});

test("AI Scout reports repeated failed MCP calls only when the caller-supplied attempt budget is exceeded", () => {
  const context = createSolveContextSnapshot([mcpCall()]);

  const withinBudget = analyzeAiContext(context, { budgets: { maxMcpAttempts: 4 } });
  assert.equal(withinBudget.inbox.items.length, 0);

  const exceeded = analyzeAiContext(context, { budgets: { maxMcpAttempts: 3 } });
  assert.equal(exceeded.inbox.items.length, 1);
  assert.equal(exceeded.inbox.items[0].title, "Failed MCP tool-call retry budget exceeded");
  assert.match(exceeded.inbox.items[0].summary, /4 attempts/);
  assert.match(exceeded.inbox.items[0].summary, /budget of 3/);
  assert.equal(exceeded.inbox.items[0].recommendedAction.kind, "inspect");
});

test("MCP attempt budget is not treated as a failure signal when outcome is not explicitly failure", () => {
  const context = createSolveContextSnapshot([
    mcpCall({ dimensions: { outcome: "success", tool: "catalog.lookup" }, metrics: { attempts: 9 } }),
  ]);
  const analysis = analyzeAiContext(context, { budgets: { maxMcpAttempts: 2 } });

  assert.equal(analysis.inbox.items.length, 0);
});

test("AI Scout compares explicit metrics with caller-supplied latency, token, and cost budgets", () => {
  const context = createSolveContextSnapshot([aiTrace()]);
  const analysis = analyzeAiContext(context, {
    budgets: {
      maxLatencyMs: 1000,
      maxInputTokens: 900,
      maxOutputTokens: 200,
      maxTotalTokens: 1200,
      maxCostUsd: 0.03,
    },
  });

  assert.equal(analysis.execution.candidateFindings, 5);
  assert.deepEqual(
    analysis.inbox.items.map((item) => item.title),
    [
      "AI latency budget exceeded",
      "AI cost budget exceeded",
      "AI input-token budget exceeded",
      "AI output-token budget exceeded",
      "AI total-token budget exceeded",
    ],
  );
  assert.deepEqual(analysis.inbox.items.map((item) => item.scout), ["ai", "cost", "cost", "cost", "cost"]);
  assert.ok(analysis.inbox.items.every((item) => item.confidence.score === 1));
  assert.ok(analysis.inbox.items.every((item) => item.recommendedAction.kind === "inspect"));
});

test("AI Scout does not derive total-token usage by summing other metrics", () => {
  const context = createSolveContextSnapshot([
    aiTrace({ metrics: { input_tokens: 900, output_tokens: 800 } }),
  ]);
  const analysis = analyzeAiContext(context, { budgets: { maxTotalTokens: 1000 } });

  assert.equal(analysis.inbox.items.length, 0);
});

test("AI Scout ignores non-AI Context signals and preserves that count", () => {
  const context = createSolveContextSnapshot([
    aiTrace(),
    {
      kind: "runtime-event",
      source: "fixture-events",
      locator: "event:checkout",
      observedAt: "2026-09-02T16:02:00Z",
      summary: "Sanitized aggregate runtime event.",
      metrics: { samples: 100 },
      sanitized: true,
    },
    {
      kind: "deployment",
      source: "fixture-deployments",
      locator: "deployment:abc123",
      observedAt: "2026-09-02T16:03:00Z",
      summary: "Sanitized deployment signal.",
      revision: "abc123",
      sanitized: true,
    },
  ]);
  const analysis = analyzeAiContext(context);

  assert.equal(analysis.execution.examinedSignals, 1);
  assert.equal(analysis.execution.ignoredNonAiSignals, 2);
  assert.equal(analysis.inbox.items.length, 0);
});

test("AI Scout preserves upstream Context partiality and its own Inbox truncation separately", () => {
  const context = createSolveContextSnapshot([
    aiTrace({ locator: "ai-trace:one", observedAt: "2026-09-02T16:00:00Z", dimensions: { outcome: "failure" } }),
    aiTrace({ locator: "ai-trace:two", observedAt: "2026-09-02T16:01:00Z", dimensions: { outcome: "failure" } }),
  ], { maxSignals: 1 });
  const partialFromContext = analyzeAiContext(context);

  assert.equal(partialFromContext.sourceContext.truncated, true);
  assert.equal(partialFromContext.execution.status, "partial");
  assert.deepEqual(partialFromContext.execution.partialReasons, ["context-truncated"]);

  const fullContext = createSolveContextSnapshot([
    aiTrace({ locator: "ai-trace:budget", dimensions: { outcome: "failure" } }),
  ]);
  const partialFromInbox = analyzeAiContext(fullContext, {
    budgets: { maxLatencyMs: 1000, maxCostUsd: 0.03 },
    maxFindings: 1,
  });

  assert.equal(partialFromInbox.inbox.execution.truncated, true);
  assert.equal(partialFromInbox.execution.status, "partial");
  assert.deepEqual(partialFromInbox.execution.partialReasons, ["inbox-truncated"]);
});

test("AI Scout validates caller budgets instead of accepting ambiguous thresholds", () => {
  const context = createSolveContextSnapshot([aiTrace()]);
  for (const budgets of [
    { maxLatencyMs: 0 },
    { maxInputTokens: -1 },
    { maxOutputTokens: Number.POSITIVE_INFINITY },
    { maxTotalTokens: Number.NaN },
    { maxCostUsd: -0.01 },
    { maxMcpAttempts: 1.5 },
  ]) {
    assert.throws(
      () => analyzeAiContext(context, { budgets }),
      /must be a positive|positive safe integer/,
    );
  }
});

test("AI Scout fails closed for non-observe modes", () => {
  const context = createSolveContextSnapshot([aiTrace()]);
  for (const requestedMode of ["suggest", "pr", "auto"] as const) {
    assert.throws(
      () => analyzeAiContext(context, { requestedMode }),
      /AI Scout is observe-only/,
    );
  }
});

test("AI Scout rejects a forged Context snapshot that weakens the safe boundary", () => {
  const context = createSolveContextSnapshot([aiTrace()]);
  const forged = {
    ...context,
    policy: {
      ...context.policy,
      networkAccess: true,
    },
  } as unknown as SolveContextSnapshot;

  assert.throws(
    () => analyzeAiContext(forged),
    /safe observe-only Solve Context policy boundary/,
  );
});

test("AI Scout output contains policy evidence that raw prompts, providers, credentials, writes, and mutations are unavailable", () => {
  const analysis = analyzeAiContext(createSolveContextSnapshot([aiTrace()]));

  assert.equal(analysis.policy.explicitEvidenceOnly, true);
  assert.equal(analysis.policy.callerSuppliedBudgetsOnly, true);
  assert.equal(analysis.policy.rawPromptAccess, false);
  assert.equal(analysis.policy.providerAccess, false);
  assert.equal(analysis.policy.networkAccess, false);
  assert.equal(analysis.policy.credentialAccess, false);
  assert.equal(analysis.policy.repositoryWriteAccess, false);
  assert.equal(analysis.policy.productionMutationAccess, false);
  assert.equal(analysis.policy.externalSideEffects, false);
});
