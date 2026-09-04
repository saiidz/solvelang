import assert from "node:assert/strict";
import test from "node:test";
import { createProviderConnectionPlan, type ProviderConnectionPlan } from "./selfDrivingProviderConnection";
import {
  bridgeCompletePostHogProductEventsResultToContext,
  createPostHogProductEventsQueryRequest,
  normalizePostHogProductEventsQueryResult,
  type PostHogAggregateQueryRequest,
} from "./selfDrivingPosthogQueryContract";

function plan(overrides: Parameters<typeof createProviderConnectionPlan>[0] extends infer T ? Partial<T> : never = {}) {
  return createProviderConnectionPlan({
    provider: "posthog",
    region: "us",
    tenant: { projectLocator: "project:42" },
    credentialRef: "env:POSTHOG_READ_ONLY_TOKEN",
    capabilities: ["product-events"],
    bounds: {
      maxPages: 2,
      maxRecords: 3,
      maxResponseBytes: 1_000_000,
      maxRequests: 4,
      timeoutMs: 5_000,
      lookbackMinutes: 60,
    },
    ...overrides,
  });
}

function request(): PostHogAggregateQueryRequest {
  return createPostHogProductEventsQueryRequest(plan());
}

test("PostHog product-event request contract pins US host, endpoint, method, scope, and parameterized HogQL", () => {
  const spec = request();

  assert.equal(spec.schema, "solvelang.self-driving.posthog-query-request.v0");
  assert.equal(spec.mode, "analyze-only");
  assert.match(spec.id, /^posthog_query_[a-f0-9]{16}$/);
  assert.equal(spec.capability, "product-events");
  assert.equal(spec.region, "us");
  assert.deepEqual(spec.tenant, { projectLocator: "project:42", projectId: 42 });
  assert.equal(spec.request.host, "https://us.posthog.com");
  assert.equal(spec.request.path, "/api/projects/42/query/");
  assert.equal(spec.request.method, "POST");
  assert.equal(spec.request.contentType, "application/json");
  assert.deepEqual(spec.request.authorization, {
    scheme: "bearer",
    credentialRef: "env:POSTHOG_READ_ONLY_TOKEN",
    resolved: false,
    requiredScopes: ["query:read"],
  });
  assert.equal(spec.request.body.query.kind, "HogQLQuery");
  assert.equal(spec.request.body.query.name, "solvelang_product_event_summary_v0");
  assert.equal(
    spec.request.body.query.query,
    "SELECT event, count() AS samples FROM events WHERE timestamp >= now() - toIntervalMinute({lookback_minutes}) GROUP BY event ORDER BY samples DESC LIMIT {max_records}",
  );
  assert.deepEqual(spec.request.body.query.values, {
    lookback_minutes: 60,
    max_records: 3,
  });
  assert.equal(spec.execution.status, "not-executed");
  assert.equal(spec.execution.networkRequests, 0);
  assert.equal(spec.execution.credentialResolutions, 0);
});

test("PostHog product-event request contract maps EU plans only to the fixed EU host", () => {
  const spec = createPostHogProductEventsQueryRequest(plan({ region: "eu" }));
  assert.equal(spec.request.host, "https://eu.posthog.com");
  assert.equal(spec.request.path, "/api/projects/42/query/");
});

test("request SQL has no caller-controlled identity/session/property selection and uses typed values instead of interpolation", () => {
  const spec = request();
  const sql = spec.request.body.query.query.toLowerCase();

  for (const forbidden of ["distinct_id", "person", "session", "properties", "email", "ip_address", "authorization"]) {
    assert.equal(sql.includes(forbidden), false);
  }
  assert.match(sql, /\{lookback_minutes\}/);
  assert.match(sql, /\{max_records\}/);
  assert.equal(sql.includes("60"), false);
  assert.equal(sql.includes("limit 3"), false);
  assert.equal(spec.policy.callerSuppliedSql, false);
  assert.equal(spec.policy.parameterizedValuesOnly, true);
  assert.equal(spec.policy.networkAccess, false);
  assert.equal(spec.policy.credentialResolution, false);
  assert.equal(spec.policy.mutationEndpointAccess, false);
});

test("request contract is deeply immutable and deterministic", () => {
  const first = request();
  const second = request();
  assert.deepEqual(first, second);

  for (const value of [
    first,
    first.tenant,
    first.request,
    first.request.authorization,
    first.request.authorization.requiredScopes,
    first.request.body,
    first.request.body.query,
    first.request.body.query.values,
    first.execution,
    first.policy,
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }
});

test("query request rejects nonnumeric project locators and unsafe/stale capability plans", () => {
  assert.throws(
    () => createPostHogProductEventsQueryRequest(plan({ tenant: { projectLocator: "project:checkout-demo" } })),
    /exact numeric project:<id> syntax/,
  );

  const noProductEvents = createProviderConnectionPlan({
    provider: "posthog",
    region: "us",
    tenant: { projectLocator: "project:42" },
    credentialRef: "env:POSTHOG_READ_ONLY_TOKEN",
    capabilities: ["errors"],
  });
  assert.throws(
    () => createPostHogProductEventsQueryRequest(noProductEvents),
    /product-events.*not allowlisted/,
  );

  const canonical = plan();
  const forged = {
    ...canonical,
    tenant: { projectLocator: "project:99" },
  } as ProviderConnectionPlan;
  assert.throws(
    () => createPostHogProductEventsQueryRequest(forged),
    /integrity check failed/,
  );
});

test("aggregate result normalization accepts bounded event/count rows, sorts deterministically, and drops provider metadata", () => {
  const spec = request();
  const result = normalizePostHogProductEventsQueryResult(spec, {
    columns: ["event", "samples"],
    results: [
      ["checkout_completed", 4],
      ["$pageview", 10],
      ["checkout_started", 4],
    ],
    query: "provider metadata that must not survive",
    clickhouse: "provider metadata",
    timings: [{ raw: true }],
  });

  assert.equal(result.schema, "solvelang.self-driving.posthog-query-result.v0");
  assert.equal(result.coverage, "partial");
  assert.deepEqual(result.partialReasons, ["query-limit"]);
  assert.deepEqual(result.columns, ["event", "samples"]);
  assert.deepEqual(result.rows.map((row) => [row.event, row.samples]), [
    ["$pageview", 10],
    ["checkout_completed", 4],
    ["checkout_started", 4],
  ]);
  assert.ok(result.rows.every((row) => /^posthog_event_[a-f0-9]{16}$/.test(row.id)));
  assert.equal(result.execution.inputRows, 3);
  assert.equal(result.execution.emittedRows, 3);
  assert.equal(result.execution.metadataDropped, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("clickhouse"), false);
  assert.equal(serialized.includes("timings"), false);
  assert.equal(serialized.includes("provider metadata"), false);
});

test("aggregate result can omit columns only when every row still has the strict event/count shape", () => {
  const result = normalizePostHogProductEventsQueryResult(request(), {
    results: [["signup", 2]],
  });
  assert.equal(result.coverage, "complete");
  assert.deepEqual(result.partialReasons, []);
  assert.deepEqual(result.rows.map((row) => [row.event, row.samples]), [["signup", 2]]);
});

test("aggregate result rejects unexpected columns, row shapes, duplicate events, and excessive rows", () => {
  const spec = request();

  for (const columns of [
    ["distinct_id", "samples"],
    ["event", "samples", "person"],
    ["samples", "event"],
  ]) {
    assert.throws(
      () => normalizePostHogProductEventsQueryResult(spec, { columns, results: [] }),
      /columns must be exactly event,samples/,
    );
  }

  for (const results of [
    [["event-only"]],
    [["event", 1, "extra"]],
    [{ event: "signup", samples: 1 }],
  ]) {
    assert.throws(
      () => normalizePostHogProductEventsQueryResult(spec, { results }),
      /exactly \[event, samples\]/,
    );
  }

  assert.throws(
    () => normalizePostHogProductEventsQueryResult(spec, { results: [["signup", 1], ["signup", 2]] }),
    /duplicate event row/,
  );

  assert.throws(
    () => normalizePostHogProductEventsQueryResult(spec, {
      results: [["a", 1], ["b", 1], ["c", 1], ["d", 1]],
    }),
    /exceeds the request max_records bound/,
  );
});

test("aggregate result rejects identity-, secret-, multiline-, and oversized event values", () => {
  const spec = request();
  for (const event of [
    "person@example.com",
    "192.0.2.1",
    "Bearer abcdefghijklmnopqrstuvwxyz",
    "sk-proj_abcdefghijklmnopqrstuvwxyz123456",
    "line one\nline two",
    "x".repeat(257),
  ]) {
    assert.throws(
      () => normalizePostHogProductEventsQueryResult(spec, { results: [[event, 1]] }),
      /person\/network identity|credential or secret|sanitized single-line|256-character bound/,
    );
  }
});

test("aggregate result rejects invalid sample metrics", () => {
  const spec = request();
  for (const samples of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "4"]) {
    assert.throws(
      () => normalizePostHogProductEventsQueryResult(spec, { results: [["signup", samples]] }),
      /non-negative safe integer/,
    );
  }
});

test("aggregate result preserves provider and query-limit partiality separately", () => {
  const spec = request();
  const providerPartial = normalizePostHogProductEventsQueryResult(spec, {
    results: [["signup", 1]],
    hasMore: true,
  });
  assert.equal(providerPartial.coverage, "partial");
  assert.deepEqual(providerPartial.partialReasons, ["provider-has-more"]);

  const both = normalizePostHogProductEventsQueryResult(spec, {
    results: [["a", 3], ["b", 2], ["c", 1]],
    hasMore: true,
  });
  assert.equal(both.coverage, "partial");
  assert.deepEqual(both.partialReasons, ["provider-has-more", "query-limit"]);

  assert.throws(
    () => normalizePostHogProductEventsQueryResult(spec, { results: [], hasMore: "yes" }),
    /hasMore must be a boolean/,
  );
});

test("complete aggregate results bridge into the existing sanitized PostHog adapter with observation-time provenance", () => {
  const spec = createPostHogProductEventsQueryRequest(plan({
    bounds: {
      maxPages: 2,
      maxRecords: 5,
      maxResponseBytes: 1_000_000,
      maxRequests: 4,
      timeoutMs: 5_000,
      lookbackMinutes: 60,
    },
  }));
  const result = normalizePostHogProductEventsQueryResult(spec, {
    columns: ["event", "samples"],
    results: [["signup", 2], ["$pageview", 7]],
    hasMore: false,
  });
  assert.equal(result.coverage, "complete");

  const bridge = bridgeCompletePostHogProductEventsResultToContext(
    result,
    "2026-09-04T17:30:00-04:00",
  );

  assert.equal(bridge.schema, "solvelang.self-driving.posthog-query-context-bridge.v0");
  assert.equal(bridge.observationTimestamp, "2026-09-04T21:30:00.000Z");
  assert.equal(bridge.adapter.execution.status, "complete");
  assert.equal(bridge.adapter.context.signals.length, 2);
  assert.ok(bridge.adapter.context.signals.every((signal) => signal.kind === "runtime-event"));
  assert.ok(bridge.adapter.context.signals.every((signal) => signal.observedAt === bridge.observationTimestamp));
});

test("partial aggregate results cannot be falsely bridged into a complete offline export", () => {
  const result = normalizePostHogProductEventsQueryResult(request(), {
    results: [["a", 3], ["b", 2], ["c", 1]],
  });
  assert.equal(result.coverage, "partial");
  assert.throws(
    () => bridgeCompletePostHogProductEventsResultToContext(result, "2026-09-04T21:30:00Z"),
    /cannot enter Solve Context until an exact skipped-row count is available/,
  );
});

test("bridge rejects invalid observation timestamps rather than inventing collection time", () => {
  const spec = createPostHogProductEventsQueryRequest(plan({
    bounds: {
      maxPages: 2,
      maxRecords: 5,
      maxResponseBytes: 1_000_000,
      maxRequests: 4,
      timeoutMs: 5_000,
      lookbackMinutes: 60,
    },
  }));
  const result = normalizePostHogProductEventsQueryResult(spec, { results: [["signup", 1]] });
  assert.equal(result.coverage, "complete");
  assert.throws(
    () => bridgeCompletePostHogProductEventsResultToContext(result, "not-a-time"),
    /valid timestamp/,
  );
});
