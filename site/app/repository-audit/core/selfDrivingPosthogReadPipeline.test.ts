import assert from "node:assert/strict";
import test from "node:test";
import { planPostHogReadRequest, postHogRequestPlanUrl, type PostHogRequestPlan } from "./selfDrivingPosthogRequestPlanner";
import type { PostHogSanitizedExportRecord, PostHogSanitizedExportV0 } from "./selfDrivingPosthogExport";
import {
  executePostHogReadPipeline,
  PostHogReadPipelineFailure,
  type PostHogResponseSanitizer,
} from "./selfDrivingPosthogReadPipeline";

const authorization = "Bearer fixture_pipeline_readonly_token_123456";
const auth = async () => ({ authorization });

function plan(operation: "read-events" | "read-errors" | "read-feature-flags", project = "12345"): PostHogRequestPlan {
  return planPostHogReadRequest({
    origin: "https://us.posthog.com",
    operation,
    project,
    pageSize: 50,
  });
}

function transportWith(json: unknown) {
  return async (request: { url: string }) => ({
    status: 200,
    contentType: "application/json",
    finalUrl: request.url,
    body: JSON.stringify(json),
  });
}

function sanitizedExport(
  requestPlan: PostHogRequestPlan,
  records: PostHogSanitizedExportRecord[],
  options: {
    project?: string;
    requestId?: string;
    coverage?: "complete" | "partial";
    skipped?: PostHogSanitizedExportV0["source"]["skipped"];
  } = {},
): PostHogSanitizedExportV0 {
  const project = options.project ?? "12345";
  const coverage = options.coverage ?? "complete";
  return {
    schema: "solvelang.posthog.sanitized-export.v0",
    sanitized: true,
    source: {
      projectLocator: `project:${project}`,
      exportLocator: `request:${options.requestId ?? requestPlan.request.id}`,
      coverage,
      ...(options.skipped === undefined ? {} : { skipped: options.skipped }),
    },
    records,
  };
}

function errorRecord(locator = "error:checkout-submit"): PostHogSanitizedExportRecord {
  return {
    kind: "error",
    locator,
    observedAt: "2026-09-05T01:00:00Z",
    summary: "Sanitized PostHog error evidence.",
    dimensions: { outcome: "failure", environment: "staging" },
    metrics: { samples: 12 },
    sanitized: true,
  };
}

function flagRecord(locator = "flag:new-checkout"): PostHogSanitizedExportRecord {
  return {
    kind: "feature-flag",
    locator,
    observedAt: "2026-09-05T01:01:00Z",
    summary: "Sanitized PostHog feature-flag evidence.",
    dimensions: { environment: "staging" },
    metrics: {
      conversion_rate: 0.42,
      error_rate: 0.12,
      p95_latency_ms: 1800,
    },
    sanitized: true,
  };
}

function assertPipelineFailure(category: string) {
  return (error: unknown) => {
    assert.ok(error instanceof PostHogReadPipelineFailure);
    assert.equal(error.category, category);
    return true;
  };
}

test("read-errors flows through sanitized Context and canonical Observe Run into Incident Scout", async () => {
  const requestPlan = plan("read-errors");
  const rawProviderJson = { provider_internal: "raw-error-marker" };
  let sanitizerInput: unknown;

  const result = await executePostHogReadPipeline(
    requestPlan,
    auth,
    transportWith(rawProviderJson),
    async (input) => {
      sanitizerInput = input;
      return sanitizedExport(requestPlan, [errorRecord()]);
    },
  );

  assert.deepEqual(sanitizerInput, {
    operation: "read-errors",
    project: "12345",
    requestId: requestPlan.request.id,
    json: rawProviderJson,
  });
  assert.equal(result.schema, "solvelang.self-driving.posthog-read-pipeline.v0");
  assert.equal(result.observe.schema, "solvelang.self-driving.observe-run.v0");
  assert.equal(result.context.signals.length, 1);
  assert.equal(result.context.signals[0].kind, "error");
  assert.equal(result.observe.components.product.incidentSignals, 1);
  assert.deepEqual(result.inbox.items.map((item) => item.title), [
    "Product incident evidence requires inspection",
  ]);
  assert.deepEqual(result.inbox, result.observe.inbox);
  assert.equal(result.execution.status, "complete");
});

test("read-feature-flags feeds Experience and Rollout budget findings through Observe Run", async () => {
  const requestPlan = plan("read-feature-flags");
  const result = await executePostHogReadPipeline(
    requestPlan,
    auth,
    transportWith({ results: [{ raw: "provider-flag-object" }] }),
    async () => sanitizedExport(requestPlan, [flagRecord()]),
    {
      experienceBudgets: {
        minConversionRate: 0.8,
        maxP95LatencyMs: 1000,
      },
      rolloutBudgets: {
        maxErrorRate: 0.05,
        minConversionRate: 0.75,
        maxP95LatencyMs: 1200,
      },
    },
  );

  const titles = new Set(result.inbox.items.map((item) => item.title));
  assert.equal(titles.has("Experience conversion budget missed"), true);
  assert.equal(titles.has("Experience latency budget exceeded"), true);
  assert.equal(titles.has("Rollout error-rate budget exceeded"), true);
  assert.equal(titles.has("Rollout conversion budget missed"), true);
  assert.equal(titles.has("Rollout latency budget exceeded"), true);
  assert.equal(result.observe.components.product.experienceSignals, 1);
  assert.equal(result.observe.components.product.rolloutSignals, 1);
  assert.equal(result.policy.causalityInference, false);
  assert.equal(result.policy.rolloutMutationAccess, false);
});

test("raw GET event reads fail closed before authorization, transport, or sanitizer executes", async () => {
  const requestPlan = plan("read-events");
  let authCalls = 0;
  let transportCalls = 0;
  let sanitizerCalls = 0;

  await assert.rejects(
    () => executePostHogReadPipeline(
      requestPlan,
      async () => {
        authCalls += 1;
        return { authorization };
      },
      async (request) => {
        transportCalls += 1;
        return {
          status: 200,
          contentType: "application/json",
          finalUrl: request.url,
          body: "{}",
        };
      },
      async () => {
        sanitizerCalls += 1;
        return sanitizedExport(requestPlan, []);
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof PostHogReadPipelineFailure);
      assert.equal(error.category, "unsupported-operation");
      assert.match(error.message, /aggregate product-events contract/);
      return true;
    },
  );

  assert.equal(authCalls, 0);
  assert.equal(transportCalls, 0);
  assert.equal(sanitizerCalls, 0);
});

test("sanitizer source identity must match the approved project and request", async () => {
  const requestPlan = plan("read-errors");
  for (const unsafe of [
    sanitizedExport(requestPlan, [errorRecord()], { project: "99999" }),
    sanitizedExport(requestPlan, [errorRecord()], { requestId: "phr_wrong_request" }),
  ]) {
    await assert.rejects(
      () => executePostHogReadPipeline(
        requestPlan,
        auth,
        transportWith({ raw: "identity-marker" }),
        async () => unsafe,
      ),
      assertPipelineFailure("sanitization"),
    );
  }
});

test("unsafe sanitizer output is rejected by the existing sanitized-export boundary without leaking raw values", async () => {
  const requestPlan = plan("read-errors");
  const unsafe = sanitizedExport(requestPlan, [{
    ...errorRecord(),
    dimensions: { email: "private-person@example.com" },
  }]);

  await assert.rejects(
    () => executePostHogReadPipeline(
      requestPlan,
      auth,
      transportWith({ raw: "provider-sensitive-marker" }),
      async () => unsafe,
    ),
    (error: unknown) => {
      assert.ok(error instanceof PostHogReadPipelineFailure);
      assert.equal(error.category, "sanitization");
      assert.equal(error.message.includes("private-person@example.com"), false);
      assert.equal(error.message.includes("provider-sensitive-marker"), false);
      return true;
    },
  );
});

test("operation-to-evidence mapping prevents a read from fabricating another evidence class", async () => {
  const errorPlan = plan("read-errors");
  const flagPlan = plan("read-feature-flags");

  await assert.rejects(
    () => executePostHogReadPipeline(
      errorPlan,
      auth,
      transportWith({ raw: true }),
      async () => sanitizedExport(errorPlan, [flagRecord()]),
    ),
    assertPipelineFailure("sanitization"),
  );

  await assert.rejects(
    () => executePostHogReadPipeline(
      flagPlan,
      auth,
      transportWith({ raw: true }),
      async () => sanitizedExport(flagPlan, [errorRecord()]),
    ),
    assertPipelineFailure("sanitization"),
  );
});

test("provider partiality, Context truncation, and combined Inbox truncation remain distinct", async () => {
  const requestPlan = plan("read-feature-flags");
  const result = await executePostHogReadPipeline(
    requestPlan,
    auth,
    transportWith({ results: [1, 2] }),
    async () => sanitizedExport(
      requestPlan,
      [
        flagRecord("flag:older"),
        { ...flagRecord("flag:newer"), observedAt: "2026-09-05T01:02:00Z" },
      ],
      {
        coverage: "partial",
        skipped: [{ reason: "provider-redacted", count: 3 }],
      },
    ),
    {
      maxSignals: 1,
      maxFindings: 1,
      experienceBudgets: { minConversionRate: 0.8, maxP95LatencyMs: 1000 },
      rolloutBudgets: { maxErrorRate: 0.05, minConversionRate: 0.75 },
    },
  );

  assert.equal(result.execution.status, "partial");
  assert.equal(result.execution.partialReasons.includes("source-partial"), true);
  assert.equal(result.execution.partialReasons.includes("context-truncated"), true);
  assert.equal(result.execution.partialReasons.includes("inbox-truncated"), true);
  assert.equal(result.context.execution.truncated, true);
  assert.equal(result.inbox.execution.truncated, true);
  assert.deepEqual(result.source.skipped, [{ reason: "provider-redacted", count: 3 }]);
});

test("durable pipeline output excludes raw provider JSON, authorization material, and raw headers", async () => {
  const requestPlan = plan("read-errors");
  const rawMarker = "raw-provider-payload-secret-marker";
  const result = await executePostHogReadPipeline(
    requestPlan,
    auth,
    transportWith({ raw: rawMarker }),
    async (input) => {
      assert.deepEqual(input.json, { raw: rawMarker });
      return sanitizedExport(requestPlan, [errorRecord()]);
    },
  );

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(rawMarker), false);
  assert.equal(serialized.includes("fixture_pipeline_readonly_token_123456"), false);
  assert.equal(serialized.includes("Authorization"), false);
  assert.equal(result.policy.rawProviderJsonReturned, false);
  assert.equal(result.policy.credentialMaterialReturned, false);
  assert.equal(result.transport.source.requestId, requestPlan.request.id);
  assert.equal(result.transport.source.pathname, requestPlan.request.pathname);
  assert.equal(postHogRequestPlanUrl(requestPlan).includes(result.transport.source.pathname), true);
});

test("non-observe modes fail closed before any authority-bearing callback", async () => {
  const requestPlan = plan("read-errors");
  for (const requestedMode of ["suggest", "pr", "auto"] as const) {
    let authCalls = 0;
    await assert.rejects(
      () => executePostHogReadPipeline(
        requestPlan,
        async () => {
          authCalls += 1;
          return { authorization };
        },
        transportWith({ raw: true }),
        async () => sanitizedExport(requestPlan, [errorRecord()]),
        { requestedMode },
      ),
      /observe-only/,
    );
    assert.equal(authCalls, 0);
  }
});
