import assert from "node:assert/strict";
import test from "node:test";
import { adaptSanitizedPostHogExport, type PostHogSanitizedExportV0 } from "./selfDrivingPosthogExport";

function exportFixture(records: PostHogSanitizedExportV0["records"]): PostHogSanitizedExportV0 {
  return {
    schema: "solvelang.posthog.sanitized-export.v0",
    sanitized: true,
    source: {
      projectLocator: "project:checkout-demo",
      exportLocator: "export:2026-09-02T17:00Z",
      coverage: "complete",
    },
    records,
  };
}

function record(
  kind: PostHogSanitizedExportV0["records"][number]["kind"] = "event",
  overrides: Partial<PostHogSanitizedExportV0["records"][number]> = {},
): PostHogSanitizedExportV0["records"][number] {
  return {
    kind,
    locator: `${kind}:fixture-1`,
    observedAt: "2026-09-02T17:00:00Z",
    summary: `Sanitized ${kind} aggregate evidence.`,
    dimensions: { environment: "staging", surface: "checkout" },
    metrics: { samples: 100 },
    sanitized: true,
    ...overrides,
  };
}

test("offline PostHog adapter maps sanitized product events into runtime-event Context signals", () => {
  const result = adaptSanitizedPostHogExport(exportFixture([
    record("event", {
      locator: "event:checkout-complete",
      metrics: { conversion_rate: 0.72, samples: 120 },
    }),
  ]));

  assert.equal(result.schema, "solvelang.self-driving.posthog-offline-adapter.v0");
  assert.equal(result.mode, "analyze-only");
  assert.equal(result.source.provider, "posthog");
  assert.equal(result.execution.status, "complete");
  assert.equal(result.context.schema, "solvelang.self-driving.context.v0");
  assert.equal(result.context.signals.length, 1);
  assert.equal(result.context.signals[0].kind, "runtime-event");
  assert.equal(result.context.signals[0].source, "posthog-offline-export");
  assert.equal(result.context.signals[0].locator, "posthog:project:checkout-demo:event:checkout-complete");
  assert.deepEqual(result.context.signals[0].candidateScouts, ["experience"]);
  assert.equal(result.context.signals[0].metrics.conversion_rate, 0.72);
});

test("offline PostHog adapter maps error, deployment, feature-flag, and experiment evidence without adding control authority", () => {
  const result = adaptSanitizedPostHogExport(exportFixture([
    record("error", { locator: "error:checkout-submit" }),
    record("deployment", {
      locator: "deployment:abc123",
      observedAt: "2026-09-02T17:01:00Z",
      revision: "abc123",
      dimensions: { environment: "staging", outcome: "failure" },
    }),
    record("feature-flag", {
      locator: "flag:new-checkout",
      observedAt: "2026-09-02T17:02:00Z",
      metrics: { error_rate: 0.08, conversion_rate: 0.64 },
    }),
    record("experiment", {
      locator: "experiment:checkout-copy",
      observedAt: "2026-09-02T17:03:00Z",
      metrics: { conversion_rate: 0.61 },
    }),
  ]));

  assert.deepEqual(
    new Set(result.context.signals.map((item) => item.kind)),
    new Set(["error", "deployment", "feature-flag", "experiment"]),
  );
  assert.equal(result.policy.rolloutMutationAccess, false);
  assert.equal(result.policy.repositoryWriteAccess, false);
  assert.equal(result.policy.productionMutationAccess, false);
  assert.equal(result.policy.externalSideEffects, false);
  assert.equal(result.context.signals.find((item) => item.kind === "deployment")?.revision, "abc123");
});

test("offline PostHog adapter maps sanitized AI traces and MCP tool calls for AI and Cost Scouts", () => {
  const result = adaptSanitizedPostHogExport(exportFixture([
    record("ai-trace", {
      locator: "ai-trace:sanitized-42",
      dimensions: { outcome: "failure", model_family: "reasoning-model" },
      metrics: { input_tokens: 12000, output_tokens: 900, total_tokens: 12900, cost_usd: 0.4 },
    }),
    record("mcp-tool-call", {
      locator: "mcp:catalog.lookup:sanitized-42",
      observedAt: "2026-09-02T17:01:00Z",
      dimensions: { outcome: "failure", tool: "catalog.lookup" },
      metrics: { attempts: 4, latency_ms: 4200 },
    }),
  ]));

  assert.deepEqual(
    new Set(result.context.signals.map((item) => item.kind)),
    new Set(["ai-trace", "mcp-tool-call"]),
  );
  assert.ok(result.context.signals.every((item) => item.candidateScouts.includes("ai")));
  assert.ok(result.context.signals.every((item) => item.candidateScouts.includes("cost")));
  assert.equal(result.policy.rawPromptAccess, false);
  assert.equal(result.policy.networkAccess, false);
  assert.equal(result.policy.credentialAccess, false);
});

test("adapter output is deterministic and duplicate records collapse in Solve Context", () => {
  const first = record("event", { locator: "event:first", observedAt: "2026-09-02T17:00:00Z" });
  const second = record("error", { locator: "error:second", observedAt: "2026-09-02T17:01:00Z" });
  const forward = adaptSanitizedPostHogExport(exportFixture([first, second, first]));
  const reverse = adaptSanitizedPostHogExport(exportFixture([first, second, first].reverse()));

  assert.deepEqual(forward, reverse);
  assert.equal(forward.execution.inputRecords, 3);
  assert.equal(forward.execution.duplicateSignals, 1);
  assert.equal(forward.execution.emittedSignals, 2);
  assert.deepEqual(forward.context.signals.map((item) => item.kind), ["error", "runtime-event"]);
});

test("partial source coverage and downstream Context truncation remain explicit and separate", () => {
  const input = exportFixture([
    record("event", { locator: "event:old", observedAt: "2026-09-02T17:00:00Z" }),
    record("event", { locator: "event:new", observedAt: "2026-09-02T17:01:00Z" }),
  ]);
  input.source = {
    ...input.source,
    coverage: "partial",
    skipped: [
      { reason: "provider-redacted", count: 3 },
      { reason: "outside-window", count: 9 },
    ],
  };

  const result = adaptSanitizedPostHogExport(input, { maxSignals: 1 });
  assert.equal(result.execution.status, "partial");
  assert.deepEqual(result.execution.partialReasons, ["source-partial", "context-truncated"]);
  assert.deepEqual(result.source.skipped, [
    { reason: "outside-window", count: 9 },
    { reason: "provider-redacted", count: 3 },
  ]);
  assert.equal(result.context.execution.truncated, true);
  assert.equal(result.context.signals[0].locator, "posthog:project:checkout-demo:event:new");
});

test("partial coverage requires explicit skipped-record truth and complete coverage cannot claim skips", () => {
  const partialWithoutSkipped = exportFixture([]) as unknown as Record<string, unknown>;
  partialWithoutSkipped.source = {
    projectLocator: "project:checkout-demo",
    exportLocator: "export:partial",
    coverage: "partial",
  };
  assert.throws(
    () => adaptSanitizedPostHogExport(partialWithoutSkipped),
    /source.skipped is required/,
  );

  const completeWithSkipped = exportFixture([]) as unknown as Record<string, unknown>;
  completeWithSkipped.source = {
    projectLocator: "project:checkout-demo",
    exportLocator: "export:complete",
    coverage: "complete",
    skipped: [{ reason: "provider-redacted", count: 1 }],
  };
  assert.throws(
    () => adaptSanitizedPostHogExport(completeWithSkipped),
    /coverage=complete cannot declare skipped/,
  );
});

test("adapter rejects person/profile identity fields and common identity values", () => {
  for (const unsafeDimensions of [
    { distinct_id: "person-42" },
    { person_id: "person-42" },
    { user_id: "person-42" },
    { email: "person@example.com" },
    { phone: "555-0100" },
    { ip_address: "192.0.2.1" },
    { session_id: "session-42" },
    { profile: "customer" },
    { safe_label: "person@example.com" },
    { safe_label: "192.0.2.1" },
  ] as Array<Record<string, string>>) {
    assert.throws(
      () => adaptSanitizedPostHogExport(exportFixture([
        record("event", { dimensions: unsafeDimensions }),
      ])),
      /identity\/raw-content shaped|person\/network identity/,
    );
  }
});

test("adapter rejects session replay, raw request/response, prompt, completion, and headers/cookies", () => {
  for (const unsafeKey of [
    "session_recording",
    "replay",
    "request_body",
    "response_body",
    "raw_body",
    "prompt",
    "completion",
    "headers",
    "cookies",
  ]) {
    assert.throws(
      () => adaptSanitizedPostHogExport(exportFixture([
        record("event", { dimensions: { [unsafeKey]: "redacted" } }),
      ])),
      /identity\/raw-content shaped/,
    );
  }
});

test("adapter rejects credential-shaped evidence through the downstream sanitized Context contract", () => {
  for (const dimensions of [
    { api_key: "redacted" },
    { authorization: "redacted" },
    { safe_label: "Bearer abcdefghijklmnopqrstuvwxyz" },
  ] as Array<Record<string, string>>) {
    assert.throws(
      () => adaptSanitizedPostHogExport(exportFixture([
        record("event", { dimensions }),
      ])),
      /credential-shaped metadata|sanitized evidence only/,
    );
  }
});

test("adapter rejects unsupported schema, unsanitized export/records, and arbitrary session payload kinds", () => {
  assert.throws(
    () => adaptSanitizedPostHogExport({ ...exportFixture([]), schema: "posthog.raw.v1" }),
    /Unsupported PostHog export schema/,
  );
  assert.throws(
    () => adaptSanitizedPostHogExport({ ...exportFixture([]), sanitized: false }),
    /sanitized exports only/,
  );
  assert.throws(
    () => adaptSanitizedPostHogExport(exportFixture([
      { ...record(), sanitized: false } as unknown as PostHogSanitizedExportV0["records"][number],
    ])),
    /must be explicitly sanitized/,
  );
  assert.throws(
    () => adaptSanitizedPostHogExport(exportFixture([
      { ...record(), kind: "session-replay" } as unknown as PostHogSanitizedExportV0["records"][number],
    ])),
    /Session replay and arbitrary PostHog payload kinds/,
  );
});

test("strict envelope and record schemas reject unexpected raw provider fields", () => {
  assert.throws(
    () => adaptSanitizedPostHogExport({ ...exportFixture([]), distinct_id: "person-42" }),
    /unsupported or unsafe fields: distinct_id/,
  );
  assert.throws(
    () => adaptSanitizedPostHogExport(exportFixture([
      { ...record(), person: { id: "person-42" } } as unknown as PostHogSanitizedExportV0["records"][number],
    ])),
    /unsupported or unsafe fields: person/,
  );
});

test("metadata and signal-count bounds are enforced", () => {
  const tooManyDimensions = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`dimension_${index}`, index]));
  assert.throws(
    () => adaptSanitizedPostHogExport(exportFixture([
      record("event", { dimensions: tooManyDimensions }),
    ])),
    /dimensions exceed the 32-entry bound/,
  );

  const input = exportFixture([
    record("event", { locator: "event:one" }),
    record("event", { locator: "event:two", observedAt: "2026-09-02T17:01:00Z" }),
  ]);
  const bounded = adaptSanitizedPostHogExport(input, { maxSignals: 1 });
  assert.equal(bounded.execution.status, "partial");
  assert.deepEqual(bounded.execution.partialReasons, ["context-truncated"]);

  assert.throws(
    () => adaptSanitizedPostHogExport(input, { maxSignals: 0 }),
    /maxSignals must be a positive safe integer/,
  );
});

test("adapter fails closed for suggest, PR, and auto modes", () => {
  for (const requestedMode of ["suggest", "pr", "auto"] as const) {
    assert.throws(
      () => adaptSanitizedPostHogExport(exportFixture([]), { requestedMode }),
      /adapter is observe-only/,
    );
  }
});

test("adapter policy proves offline sanitized no-authority behavior", () => {
  const result = adaptSanitizedPostHogExport(exportFixture([]));

  assert.equal(result.policy.offlineExportOnly, true);
  assert.equal(result.policy.sanitizedOnly, true);
  assert.equal(result.policy.personIdentityAccess, false);
  assert.equal(result.policy.sessionReplayAccess, false);
  assert.equal(result.policy.rawBodyAccess, false);
  assert.equal(result.policy.rawPromptAccess, false);
  assert.equal(result.policy.networkAccess, false);
  assert.equal(result.policy.credentialAccess, false);
  assert.equal(result.policy.repositoryWriteAccess, false);
  assert.equal(result.policy.rolloutMutationAccess, false);
  assert.equal(result.policy.productionMutationAccess, false);
  assert.equal(result.policy.externalSideEffects, false);
});
