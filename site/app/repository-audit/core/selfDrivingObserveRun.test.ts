import assert from "node:assert/strict";
import test from "node:test";
import { createSolveContextSnapshot, type SolveContextSignalInput, type SolveContextSnapshot } from "./selfDrivingContext";
import { runSelfDrivingObserve } from "./selfDrivingObserveRun";

function signal(overrides: Partial<SolveContextSignalInput> = {}): SolveContextSignalInput {
  return {
    kind: "runtime-event",
    source: "fixture-context",
    locator: "event:checkout",
    observedAt: "2026-09-04T17:00:00Z",
    summary: "Sanitized aggregate product signal.",
    dimensions: { environment: "staging" },
    metrics: {},
    sanitized: true,
    ...overrides,
  };
}

test("Observe Run composes AI, Cost, Experience, Incident, and Rollout findings into one canonical Inbox", () => {
  const context = createSolveContextSnapshot([
    signal({
      kind: "ai-trace",
      locator: "ai:failed",
      observedAt: "2026-09-04T17:05:00Z",
      dimensions: { outcome: "failure" },
      metrics: { latency_ms: 2400, cost_usd: 0.5 },
    }),
    signal({
      kind: "runtime-event",
      locator: "event:checkout-conversion",
      observedAt: "2026-09-04T17:04:00Z",
      metrics: { conversion_rate: 0.4 },
    }),
    signal({
      kind: "error",
      locator: "error:checkout-submit",
      observedAt: "2026-09-04T17:03:00Z",
      summary: "Sanitized checkout submit error aggregate.",
    }),
    signal({
      kind: "deployment",
      locator: "deployment:abc123",
      observedAt: "2026-09-04T17:02:00Z",
      revision: "abc123",
      dimensions: { outcome: "failure" },
      metrics: { error_rate: 0.1 },
    }),
  ]);

  const run = runSelfDrivingObserve(context, {
    aiBudgets: { maxLatencyMs: 1000, maxCostUsd: 0.2 },
    experienceBudgets: { minConversionRate: 0.7 },
    rolloutBudgets: { maxErrorRate: 0.05 },
  });

  assert.equal(run.schema, "solvelang.self-driving.observe-run.v0");
  assert.equal(run.mode, "analyze-only");
  assert.equal(run.execution.status, "complete");
  assert.deepEqual(run.execution.partialReasons, []);
  assert.equal(run.execution.candidateFindings, 6);
  assert.equal(run.execution.componentEmittedFindings, 6);
  assert.equal(run.execution.combinedInputFindings, 6);
  assert.equal(run.execution.combinedUniqueFindings, 6);
  assert.equal(run.execution.emittedFindings, 6);
  assert.equal(run.inbox.items.length, 6);
  assert.deepEqual(new Set(run.inbox.items.map((item) => item.scout)), new Set([
    "ai",
    "cost",
    "experience",
    "incident",
    "rollout",
  ]));
  assert.deepEqual(new Set(run.inbox.items.map((item) => item.title)), new Set([
    "AI trace reported an explicit failure",
    "AI latency budget exceeded",
    "AI cost budget exceeded",
    "Experience conversion budget missed",
    "Product incident evidence requires inspection",
    "Deployment reported an explicit failure",
    "Rollout error-rate budget exceeded",
  ].filter((title) => title !== "AI latency budget exceeded" || true)));
  assert.ok(run.inbox.items.every((item) => item.recommendedAction.kind === "inspect"));
});

test("Observe Run does not invent KPI, latency, token, or cost findings when budgets are absent", () => {
  const context = createSolveContextSnapshot([
    signal({
      kind: "ai-trace",
      locator: "ai:large-but-successful",
      dimensions: { outcome: "success" },
      metrics: {
        latency_ms: 999999,
        input_tokens: 999999,
        output_tokens: 999999,
        total_tokens: 1999998,
        cost_usd: 999999,
      },
    }),
    signal({
      kind: "runtime-event",
      locator: "event:low-conversion",
      metrics: { conversion_rate: 0.001, abandonment_rate: 0.999, p95_latency_ms: 999999 },
    }),
  ]);

  const run = runSelfDrivingObserve(context);
  assert.deepEqual(run.budgets, { ai: {}, experience: {}, rollout: {} });
  assert.equal(run.execution.candidateFindings, 0);
  assert.equal(run.inbox.items.length, 0);
});

test("Observe Run keeps component analyzers above their historical default cap so final Inbox owns truncation", () => {
  const inputs = Array.from({ length: 201 }, (_, index) => signal({
    kind: "ai-trace",
    locator: `ai:failure-${index.toString().padStart(3, "0")}`,
    observedAt: new Date(Date.UTC(2026, 8, 4, 17, 0, index)).toISOString(),
    dimensions: { outcome: "failure" },
    summary: "Sanitized explicit AI failure signal.",
  }));
  const context = createSolveContextSnapshot(inputs);
  const run = runSelfDrivingObserve(context, { maxFindings: 250 });

  assert.equal(run.components.ai.candidateFindings, 201);
  assert.equal(run.components.ai.emittedFindings, 201);
  assert.equal(run.components.ai.inboxTruncated, false);
  assert.equal(run.execution.combinedInputFindings, 201);
  assert.equal(run.inbox.execution.truncated, false);
  assert.equal(run.inbox.items.length, 201);
});

test("Observe Run applies user-visible truncation only at the combined canonical Inbox", () => {
  const context = createSolveContextSnapshot([
    signal({ kind: "error", locator: "error:one" }),
    signal({ kind: "error", locator: "error:two", observedAt: "2026-09-04T17:01:00Z" }),
    signal({ kind: "error", locator: "error:three", observedAt: "2026-09-04T17:02:00Z" }),
  ]);
  const run = runSelfDrivingObserve(context, { maxFindings: 1 });

  assert.equal(run.components.product.inboxTruncated, false);
  assert.equal(run.inbox.execution.truncated, true);
  assert.equal(run.inbox.items.length, 1);
  assert.equal(run.execution.status, "partial");
  assert.deepEqual(run.execution.partialReasons, ["combined-inbox-truncated"]);
});

test("Observe Run preserves upstream Context partiality separately from final Inbox truncation", () => {
  const context = createSolveContextSnapshot([
    signal({ kind: "error", locator: "error:old", observedAt: "2026-09-04T17:00:00Z" }),
    signal({ kind: "error", locator: "error:new", observedAt: "2026-09-04T17:01:00Z" }),
  ], { maxSignals: 1 });
  const run = runSelfDrivingObserve(context);

  assert.equal(context.execution.status, "partial");
  assert.equal(run.sourceContext.truncated, true);
  assert.equal(run.inbox.execution.truncated, false);
  assert.equal(run.execution.status, "partial");
  assert.deepEqual(run.execution.partialReasons, ["context-partial"]);
});

test("Observe Run is deterministic for equivalent Context evidence and policy", () => {
  const inputs = [
    signal({ kind: "error", locator: "error:a", observedAt: "2026-09-04T17:00:00Z" }),
    signal({
      kind: "runtime-event",
      locator: "event:b",
      observedAt: "2026-09-04T17:01:00Z",
      metrics: { conversion_rate: 0.5 },
    }),
    signal({
      kind: "ai-trace",
      locator: "ai:c",
      observedAt: "2026-09-04T17:02:00Z",
      dimensions: { outcome: "failure" },
    }),
  ];
  const forward = runSelfDrivingObserve(createSolveContextSnapshot(inputs), {
    experienceBudgets: { minConversionRate: 0.8 },
  });
  const reverse = runSelfDrivingObserve(createSolveContextSnapshot([...inputs].reverse()), {
    experienceBudgets: { minConversionRate: 0.8 },
  });

  assert.deepEqual(forward, reverse);
});

test("Observe Run fails closed for suggest, PR, and auto modes", () => {
  const context = createSolveContextSnapshot([signal()]);
  for (const requestedMode of ["suggest", "pr", "auto"] as const) {
    assert.throws(
      () => runSelfDrivingObserve(context, { requestedMode }),
      /Observe Run is observe-only/,
    );
  }
});

test("Observe Run rejects forged Context policy that weakens the safe evidence boundary", () => {
  const context = createSolveContextSnapshot([signal()]);
  const forged = {
    ...context,
    policy: { ...context.policy, networkAccess: true },
  } as unknown as SolveContextSnapshot;

  assert.throws(
    () => runSelfDrivingObserve(forged),
    /safe observe-only Solve Context policy boundary/,
  );
});

test("Observe Run rejects more than 500 emitted Context signals before component fanout", () => {
  const context = createSolveContextSnapshot([signal()]);
  const forged = {
    ...context,
    signals: Array.from({ length: 501 }, (_, index) => ({
      ...context.signals[0],
      id: `ctx_${index.toString(16).padStart(16, "0")}`,
      locator: `event:oversized-${index}`,
    })),
  } as SolveContextSnapshot;

  assert.throws(
    () => runSelfDrivingObserve(forged),
    /accepts at most 500 emitted Context signals/,
  );
});

test("Observe Run delegates invalid budgets and final finding limits to strict existing contracts", () => {
  const context = createSolveContextSnapshot([signal()]);

  assert.throws(
    () => runSelfDrivingObserve(context, { aiBudgets: { maxCostUsd: -1 } }),
    /maxCostUsd must be a positive/,
  );
  assert.throws(
    () => runSelfDrivingObserve(context, { experienceBudgets: { minConversionRate: 2 } }),
    /finite rate between 0 and 1/,
  );
  assert.throws(
    () => runSelfDrivingObserve(context, { maxFindings: 0 }),
    /maxFindings must be a positive safe integer/,
  );
});

test("Observe Run output proves no provider, network, credential, write, rollout, production, or side-effect authority", () => {
  const run = runSelfDrivingObserve(createSolveContextSnapshot([signal()]));

  assert.equal(run.policy.explicitEvidenceOnly, true);
  assert.equal(run.policy.callerSuppliedBudgetsOnly, true);
  assert.equal(run.policy.causalityInference, false);
  assert.equal(run.policy.providerAccess, false);
  assert.equal(run.policy.networkAccess, false);
  assert.equal(run.policy.credentialAccess, false);
  assert.equal(run.policy.repositoryWriteAccess, false);
  assert.equal(run.policy.rolloutMutationAccess, false);
  assert.equal(run.policy.productionMutationAccess, false);
  assert.equal(run.policy.externalSideEffects, false);
  assert.deepEqual(run.inbox.policy.allowedActions, ["inspect"]);
});
