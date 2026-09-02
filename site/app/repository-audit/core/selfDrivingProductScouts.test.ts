import assert from "node:assert/strict";
import test from "node:test";
import { createSolveContextSnapshot, type SolveContextSignalInput, type SolveContextSnapshot } from "./selfDrivingContext";
import { analyzeProductContext } from "./selfDrivingProductScouts";

function signal(overrides: Partial<SolveContextSignalInput> = {}): SolveContextSignalInput {
  return {
    kind: "runtime-event",
    source: "fixture-product-signals",
    locator: "event:checkout-step",
    observedAt: "2026-09-02T17:00:00Z",
    summary: "Sanitized product signal summary.",
    dimensions: { surface: "checkout" },
    metrics: {},
    sanitized: true,
    ...overrides,
  };
}

test("Incident Scout reports direct error signals without inferring root cause", () => {
  const context = createSolveContextSnapshot([
    signal({
      kind: "error",
      locator: "error:checkout-submit",
      summary: "Sanitized checkout error signal.",
      dimensions: { route: "/checkout" },
    }),
  ]);
  const analysis = analyzeProductContext(context);

  assert.equal(analysis.schema, "solvelang.self-driving.product-scouts.v0");
  assert.equal(analysis.execution.incidentSignals, 1);
  assert.equal(analysis.inbox.items.length, 1);
  assert.equal(analysis.inbox.items[0].scout, "incident");
  assert.equal(analysis.inbox.items[0].title, "Product incident evidence requires inspection");
  assert.match(analysis.inbox.items[0].summary, /without inferring a root cause/);
  assert.equal(analysis.inbox.items[0].recommendedAction.kind, "inspect");
  assert.equal(analysis.inbox.items[0].provenance[0].kind, "error");
});

test("Incident Scout requires explicit failure/error state for trace and log signals", () => {
  const context = createSolveContextSnapshot([
    signal({
      kind: "trace",
      locator: "trace:success",
      dimensions: { outcome: "success" },
    }),
    signal({
      kind: "trace",
      locator: "trace:failure",
      observedAt: "2026-09-02T17:01:00Z",
      dimensions: { outcome: "failure" },
    }),
    signal({
      kind: "log",
      locator: "log:info",
      observedAt: "2026-09-02T17:02:00Z",
      dimensions: { level: "info" },
    }),
    signal({
      kind: "log",
      locator: "log:error",
      observedAt: "2026-09-02T17:03:00Z",
      dimensions: { level: "error" },
    }),
  ]);
  const analysis = analyzeProductContext(context);

  assert.equal(analysis.execution.incidentSignals, 2);
  assert.equal(analysis.inbox.items.length, 2);
  assert.deepEqual(
    new Set(analysis.inbox.items.map((item) => item.provenance[0].locator)),
    new Set(["trace:failure", "log:error"]),
  );
});

test("Experience Scout does not invent KPI findings without caller-supplied budgets", () => {
  const context = createSolveContextSnapshot([
    signal({
      metrics: {
        conversion_rate: 0.01,
        abandonment_rate: 0.99,
        p95_latency_ms: 60000,
      },
    }),
  ]);
  const analysis = analyzeProductContext(context);

  assert.deepEqual(analysis.budgets.experience, {});
  assert.equal(analysis.execution.experienceSignals, 1);
  assert.equal(analysis.inbox.items.length, 0);
});

test("Experience Scout compares sanitized metrics with explicit conversion, abandonment, and latency budgets", () => {
  const context = createSolveContextSnapshot([
    signal({
      metrics: {
        conversion_rate: 0.65,
        abandonment_rate: 0.35,
        p95_latency_ms: 2400,
      },
    }),
  ]);
  const analysis = analyzeProductContext(context, {
    experienceBudgets: {
      minConversionRate: 0.7,
      maxAbandonmentRate: 0.3,
      maxP95LatencyMs: 2000,
    },
  });

  assert.equal(analysis.execution.candidateFindings, 3);
  assert.deepEqual(
    new Set(analysis.inbox.items.map((item) => item.title)),
    new Set([
      "Experience conversion budget missed",
      "Experience abandonment budget exceeded",
      "Experience latency budget exceeded",
    ]),
  );
  assert.ok(analysis.inbox.items.every((item) => item.scout === "experience"));
  assert.ok(analysis.inbox.items.every((item) => item.confidence.score === 1));
  assert.ok(analysis.inbox.items.every((item) => item.recommendedAction.kind === "inspect"));
});

test("Experience budgets apply only to product-experience signal classes", () => {
  const context = createSolveContextSnapshot([
    signal({
      kind: "error",
      locator: "error:with-conversion-metric",
      metrics: { conversion_rate: 0.1 },
    }),
  ]);
  const analysis = analyzeProductContext(context, {
    experienceBudgets: { minConversionRate: 0.9 },
  });

  assert.equal(analysis.execution.experienceSignals, 0);
  assert.equal(analysis.inbox.items.length, 1);
  assert.equal(analysis.inbox.items[0].scout, "incident");
});

test("Rollout Scout reports explicit failed deployment without attributing product metrics to it", () => {
  const context = createSolveContextSnapshot([
    signal({
      kind: "deployment",
      locator: "deployment:failed-42",
      dimensions: { outcome: "failure", environment: "staging" },
      revision: "abc123",
    }),
  ]);
  const analysis = analyzeProductContext(context);

  assert.equal(analysis.execution.rolloutSignals, 1);
  assert.equal(analysis.inbox.items.length, 1);
  assert.equal(analysis.inbox.items[0].scout, "rollout");
  assert.equal(analysis.inbox.items[0].title, "Deployment reported an explicit failure");
  assert.match(analysis.inbox.items[0].summary, /without attributing downstream product changes/);
  assert.equal(analysis.policy.causalityInference, false);
  assert.equal(analysis.inbox.items[0].provenance[0].revision, "abc123");
});

test("Rollout Scout compares only explicit rollout KPI metrics with caller-supplied budgets", () => {
  const context = createSolveContextSnapshot([
    signal({
      kind: "feature-flag",
      locator: "flag:new-checkout",
      dimensions: { state: "candidate" },
      metrics: {
        error_rate: 0.08,
        conversion_rate: 0.64,
        p95_latency_ms: 2600,
      },
    }),
  ]);
  const noBudgets = analyzeProductContext(context);
  assert.equal(noBudgets.inbox.items.length, 0);

  const analysis = analyzeProductContext(context, {
    rolloutBudgets: {
      maxErrorRate: 0.05,
      minConversionRate: 0.7,
      maxP95LatencyMs: 2000,
    },
  });

  assert.equal(analysis.execution.candidateFindings, 3);
  assert.deepEqual(
    new Set(analysis.inbox.items.map((item) => item.title)),
    new Set([
      "Rollout error-rate budget exceeded",
      "Rollout conversion budget missed",
      "Rollout latency budget exceeded",
    ]),
  );
  assert.ok(analysis.inbox.items.every((item) => item.scout === "rollout"));
  assert.ok(analysis.inbox.items.every((item) => /does not infer|not proof|does not establish/.test(item.impact)));
});

test("feature-flag and experiment signals may be evaluated independently for Experience and Rollout policy", () => {
  const context = createSolveContextSnapshot([
    signal({
      kind: "experiment",
      locator: "experiment:checkout-copy",
      metrics: { conversion_rate: 0.6 },
    }),
  ]);
  const analysis = analyzeProductContext(context, {
    experienceBudgets: { minConversionRate: 0.8 },
    rolloutBudgets: { minConversionRate: 0.7 },
  });

  assert.equal(analysis.execution.experienceSignals, 1);
  assert.equal(analysis.execution.rolloutSignals, 1);
  assert.deepEqual(new Set(analysis.inbox.items.map((item) => item.scout)), new Set(["experience", "rollout"]));
});

test("Product Scouts validate rate and latency budgets", () => {
  const context = createSolveContextSnapshot([signal()]);
  const invalidOptions = [
    { experienceBudgets: { minConversionRate: -0.1 } },
    { experienceBudgets: { maxAbandonmentRate: 1.1 } },
    { experienceBudgets: { maxP95LatencyMs: 0 } },
    { rolloutBudgets: { maxErrorRate: Number.NaN } },
    { rolloutBudgets: { minConversionRate: 2 } },
    { rolloutBudgets: { maxP95LatencyMs: Number.POSITIVE_INFINITY } },
  ];

  for (const options of invalidOptions) {
    assert.throws(
      () => analyzeProductContext(context, options),
      /finite rate between 0 and 1|positive finite value/,
    );
  }
});

test("Product Scouts preserve upstream Context truncation and downstream Inbox truncation separately", () => {
  const partialContext = createSolveContextSnapshot([
    signal({ kind: "error", locator: "error:one" }),
    signal({ kind: "error", locator: "error:two", observedAt: "2026-09-02T17:01:00Z" }),
  ], { maxSignals: 1 });
  const fromContext = analyzeProductContext(partialContext);

  assert.equal(fromContext.execution.status, "partial");
  assert.deepEqual(fromContext.execution.partialReasons, ["context-truncated"]);
  assert.equal(fromContext.sourceContext.truncated, true);

  const fullContext = createSolveContextSnapshot([
    signal({
      metrics: {
        conversion_rate: 0.5,
        abandonment_rate: 0.5,
        p95_latency_ms: 5000,
      },
    }),
  ]);
  const fromInbox = analyzeProductContext(fullContext, {
    experienceBudgets: {
      minConversionRate: 0.8,
      maxAbandonmentRate: 0.2,
      maxP95LatencyMs: 1000,
    },
    maxFindings: 1,
  });

  assert.equal(fromInbox.execution.status, "partial");
  assert.deepEqual(fromInbox.execution.partialReasons, ["inbox-truncated"]);
  assert.equal(fromInbox.inbox.execution.truncated, true);
});

test("Product Scouts fail closed for non-observe modes", () => {
  const context = createSolveContextSnapshot([signal()]);
  for (const requestedMode of ["suggest", "pr", "auto"] as const) {
    assert.throws(
      () => analyzeProductContext(context, { requestedMode }),
      /Product Scouts are observe-only/,
    );
  }
});

test("Product Scouts reject forged Context policy that weakens the safe boundary", () => {
  const context = createSolveContextSnapshot([signal()]);
  const forged = {
    ...context,
    policy: {
      ...context.policy,
      credentialAccess: true,
    },
  } as unknown as SolveContextSnapshot;

  assert.throws(
    () => analyzeProductContext(forged),
    /safe observe-only Solve Context policy boundary/,
  );
});

test("Product Scout output records that providers, credentials, writes, rollout mutation, and production mutation are unavailable", () => {
  const analysis = analyzeProductContext(createSolveContextSnapshot([signal()]));

  assert.equal(analysis.policy.explicitEvidenceOnly, true);
  assert.equal(analysis.policy.callerSuppliedBudgetsOnly, true);
  assert.equal(analysis.policy.causalityInference, false);
  assert.equal(analysis.policy.providerAccess, false);
  assert.equal(analysis.policy.networkAccess, false);
  assert.equal(analysis.policy.credentialAccess, false);
  assert.equal(analysis.policy.repositoryWriteAccess, false);
  assert.equal(analysis.policy.rolloutMutationAccess, false);
  assert.equal(analysis.policy.productionMutationAccess, false);
  assert.equal(analysis.policy.externalSideEffects, false);
});
