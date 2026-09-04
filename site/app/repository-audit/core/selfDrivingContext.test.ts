import assert from "node:assert/strict";
import test from "node:test";
import { createSolveContextSnapshot, type SolveContextSignalInput } from "./selfDrivingContext";

function signal(overrides: Partial<SolveContextSignalInput> = {}): SolveContextSignalInput {
  return {
    kind: "runtime-event",
    source: "fixture-product-events",
    locator: "event:checkout-step-3",
    observedAt: "2026-09-02T16:00:00.000Z",
    summary: "Checkout step completion decreased in the sanitized aggregate.",
    dimensions: {
      surface: "checkout",
      environment: "staging",
    },
    metrics: {
      conversion_rate: 0.72,
      samples: 120,
    },
    sanitized: true,
    ...overrides,
  };
}

test("Solve Context deterministically normalizes Experience, Incident, and Rollout signals", () => {
  const inputs: SolveContextSignalInput[] = [
    signal(),
    signal({
      kind: "error",
      source: "fixture-errors",
      locator: "error:checkout-submit",
      observedAt: "2026-09-02T16:03:00-04:00",
      summary: "Sanitized checkout submit failures increased after the candidate deployment.",
      dimensions: { environment: "staging", route: "/checkout" },
      metrics: { failures: 9 },
    }),
    signal({
      kind: "deployment",
      source: "fixture-deployments",
      locator: "deployment:abc123",
      observedAt: "2026-09-02T19:55:00Z",
      summary: "Candidate revision was deployed to the staging environment.",
      revision: "abc123",
      dimensions: { environment: "staging" },
      metrics: {},
    }),
  ];

  const forward = createSolveContextSnapshot(inputs);
  const reverse = createSolveContextSnapshot([...inputs].reverse());

  assert.deepEqual(forward, reverse);
  assert.equal(forward.schema, "solvelang.self-driving.context.v0");
  assert.equal(forward.mode, "analyze-only");
  assert.equal(forward.policy.requestedMode, "observe");
  assert.equal(forward.policy.effectiveMode, "observe");
  assert.equal(forward.policy.sanitizedOnly, true);
  assert.equal(forward.policy.networkAccess, false);
  assert.equal(forward.policy.credentialAccess, false);
  assert.equal(forward.policy.repositoryWriteAccess, false);
  assert.equal(forward.policy.productionMutationAccess, false);
  assert.equal(forward.policy.externalSideEffects, false);
  assert.deepEqual(forward.signals.map((item) => item.kind), ["error", "deployment", "runtime-event"]);
  assert.deepEqual(forward.signals.find((item) => item.kind === "runtime-event")?.candidateScouts, ["experience"]);
  assert.deepEqual(forward.signals.find((item) => item.kind === "error")?.candidateScouts, ["incident"]);
  assert.deepEqual(forward.signals.find((item) => item.kind === "deployment")?.candidateScouts, ["incident", "rollout"]);
  assert.ok(forward.signals.every((item) => /^ctx_[a-f0-9]{16}$/.test(item.id)));
});

test("Solve Context routes sanitized AI traces and MCP tool calls to AI and Cost scout candidates", () => {
  const snapshot = createSolveContextSnapshot([
    signal({
      kind: "ai-trace",
      source: "fixture-ai-traces",
      locator: "ai-trace:sanitized-42",
      summary: "The sanitized agent trace used more model tokens than the prior baseline.",
      dimensions: { model_family: "reasoning-model", outcome: "success" },
      metrics: { input_tokens: 12000, output_tokens: 900, latency_ms: 8500 },
    }),
    signal({
      kind: "mcp-tool-call",
      source: "fixture-mcp-traces",
      locator: "mcp:catalog.lookup:sanitized-42",
      observedAt: "2026-09-02T16:01:00Z",
      summary: "A sanitized trace recorded repeated failed calls to the same MCP tool.",
      dimensions: { tool: "catalog.lookup", outcome: "failure" },
      metrics: { attempts: 4, latency_ms: 4200 },
    }),
  ]);

  assert.equal(snapshot.signals.length, 2);
  assert.ok(snapshot.signals.every((item) => item.candidateScouts.includes("ai")));
  assert.ok(snapshot.signals.every((item) => item.candidateScouts.includes("cost")));
  assert.equal(snapshot.policy.externalSideEffects, false);
});

test("Solve Context canonicalizes timestamps and metadata order before identity and duplicate detection", () => {
  const first = signal({
    observedAt: "2026-09-02T12:00:00-04:00",
    dimensions: { zeta: "last", alpha: "first" },
    metrics: { zeta_ms: 9, alpha_count: 1 },
  });
  const second = signal({
    observedAt: "2026-09-02T16:00:00.000Z",
    dimensions: { alpha: "first", zeta: "last" },
    metrics: { alpha_count: 1, zeta_ms: 9 },
  });

  const snapshot = createSolveContextSnapshot([first, second]);
  assert.equal(snapshot.execution.inputSignals, 2);
  assert.equal(snapshot.execution.uniqueSignals, 1);
  assert.equal(snapshot.execution.duplicateSignals, 1);
  assert.equal(snapshot.signals[0].observedAt, "2026-09-02T16:00:00.000Z");
  assert.deepEqual(Object.keys(snapshot.signals[0].dimensions), ["alpha", "zeta"]);
  assert.deepEqual(Object.keys(snapshot.signals[0].metrics), ["alpha_count", "zeta_ms"]);
});

test("Solve Context applies deterministic signal-count bounds", () => {
  const snapshot = createSolveContextSnapshot([
    signal({ locator: "event:old", observedAt: "2026-09-02T10:00:00Z" }),
    signal({ locator: "event:new", observedAt: "2026-09-02T12:00:00Z" }),
    signal({ locator: "event:middle", observedAt: "2026-09-02T11:00:00Z" }),
  ], { maxSignals: 2 });

  assert.equal(snapshot.execution.status, "partial");
  assert.equal(snapshot.execution.truncated, true);
  assert.deepEqual(snapshot.execution.truncationReasons, ["signal-count"]);
  assert.equal(snapshot.execution.uniqueSignals, 3);
  assert.equal(snapshot.execution.emittedSignals, 2);
  assert.deepEqual(snapshot.signals.map((item) => item.locator), ["event:new", "event:middle"]);
});

test("Solve Context rejects credential-shaped metadata keys", () => {
  for (const key of ["authorization", "api_key", "access_token", "client-secret", "private_key", "cookie"] as const) {
    assert.throws(
      () => createSolveContextSnapshot([signal({ dimensions: { [key]: "redacted" } })]),
      /credential-shaped metadata/,
    );
  }
});

test("Solve Context rejects common secret-shaped values even under safe metadata keys", () => {
  for (const value of [
    "Bearer abcdefghijklmnopqrstuvwxyz",
    "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
    "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
    "AKIAABCDEFGHIJKLMNOP",
    "-----BEGIN PRIVATE KEY-----",
  ]) {
    assert.throws(
      () => createSolveContextSnapshot([signal({ dimensions: { safe_label: value } })]),
      /sanitized evidence only/,
    );
  }
});

test("Solve Context rejects multiline raw-looking summaries and invalid timestamps", () => {
  assert.throws(
    () => createSolveContextSnapshot([signal({ summary: "line one\nraw log line two" })]),
    /sanitized single-line/,
  );
  assert.throws(
    () => createSolveContextSnapshot([signal({ observedAt: "not-a-time" })]),
    /valid timestamp/,
  );
});

test("Solve Context fails closed for non-observe modes and unsanitized runtime input", () => {
  for (const requestedMode of ["suggest", "pr", "auto"] as const) {
    assert.throws(
      () => createSolveContextSnapshot([signal()], { requestedMode }),
      /normalization is observe-only/,
    );
  }

  const unsafe = { ...signal(), sanitized: false } as unknown as SolveContextSignalInput;
  assert.throws(
    () => createSolveContextSnapshot([unsafe]),
    /sanitized signals only/,
  );
});

test("Solve Context bounds dimensions, metrics, and text", () => {
  const tooManyDimensions = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`dim_${index}`, index]));
  const tooManyMetrics = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`metric_${index}`, index]));

  assert.throws(
    () => createSolveContextSnapshot([signal({ dimensions: tooManyDimensions })]),
    /dimensions exceed/,
  );
  assert.throws(
    () => createSolveContextSnapshot([signal({ metrics: tooManyMetrics })]),
    /metrics exceed/,
  );
  assert.throws(
    () => createSolveContextSnapshot([signal({ summary: "x".repeat(1025) })]),
    /1024-character bound/,
  );
});
