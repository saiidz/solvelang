import assert from "node:assert/strict";
import test from "node:test";
import { createProviderConnectionPlan, type ProviderConnectionPlanInput } from "./selfDrivingProviderConnection";
import {
  createPostHogProductEventsQueryRequest,
  type PostHogAggregateQueryRequest,
} from "./selfDrivingPosthogQueryContract";
import {
  createPostHogTransportSimulationInvocation,
  simulatePostHogProductEventsTransport,
} from "./selfDrivingPosthogTransportSimulation";

function plan(overrides: Partial<ProviderConnectionPlanInput> = {}) {
  return createProviderConnectionPlan({
    provider: "posthog",
    region: "us",
    tenant: { projectLocator: "project:42" },
    credentialRef: "env:POSTHOG_READ_ONLY_TOKEN",
    capabilities: ["product-events"],
    bounds: {
      maxPages: 2,
      maxRecords: 5,
      maxResponseBytes: 2_000,
      maxRequests: 4,
      timeoutMs: 5_000,
      lookbackMinutes: 60,
    },
    ...overrides,
  });
}

function request(overrides: Partial<ProviderConnectionPlanInput> = {}): PostHogAggregateQueryRequest {
  return createPostHogProductEventsQueryRequest(plan(overrides));
}

function fixture(body: unknown, overrides: Record<string, unknown> = {}) {
  return {
    schema: "solvelang.self-driving.posthog-transport-fixture.v0",
    status: 200,
    elapsedMs: 120,
    requestCount: 1,
    responseCount: 1,
    bodyText: JSON.stringify(body),
    ...overrides,
  };
}

function freezeForgedRequest(value: PostHogAggregateQueryRequest): PostHogAggregateQueryRequest {
  Object.freeze(value.tenant);
  Object.freeze(value.transportBounds);
  Object.freeze(value.request.authorization.requiredScopes);
  Object.freeze(value.request.authorization);
  Object.freeze(value.request.body.query.values);
  Object.freeze(value.request.body.query);
  Object.freeze(value.request.body);
  Object.freeze(value.request);
  Object.freeze(value.execution);
  Object.freeze(value.policy);
  return Object.freeze(value);
}

test("transport invocation serializes only the exact approved US request and preserves credential reference without resolving it", () => {
  const spec = request();
  const invocation = createPostHogTransportSimulationInvocation(spec);

  assert.equal(invocation.schema, "solvelang.self-driving.posthog-transport-invocation.v0");
  assert.match(invocation.id, /^posthog_fixture_invocation_[a-f0-9]{16}$/);
  assert.equal(invocation.requestId, spec.id);
  assert.equal(invocation.outbound.method, "POST");
  assert.equal(invocation.outbound.url, "https://us.posthog.com/api/projects/42/query/");
  assert.equal(invocation.outbound.contentType, "application/json");
  assert.deepEqual(invocation.outbound.authorization, {
    scheme: "bearer",
    credentialRef: "env:POSTHOG_READ_ONLY_TOKEN",
    resolved: false,
    requiredScopes: ["query:read"],
  });
  assert.equal(invocation.outbound.bodyText, JSON.stringify(spec.request.body));
  assert.equal(invocation.outbound.bodyBytes, new TextEncoder().encode(invocation.outbound.bodyText).byteLength);
  assert.deepEqual(invocation.bounds, {
    maxPages: 2,
    maxResponseBytes: 2_000,
    maxRequests: 4,
    timeoutMs: 5_000,
  });
  assert.equal(invocation.execution.networkRequests, 0);
  assert.equal(invocation.execution.credentialResolutions, 0);
  assert.equal(invocation.policy.fixtureOnly, true);
  assert.equal(invocation.policy.networkAccess, false);
  assert.equal(invocation.policy.credentialResolution, false);
  assert.equal(invocation.policy.externalSideEffects, false);
});

test("transport invocation maps only the approved EU host for EU plans", () => {
  const invocation = createPostHogTransportSimulationInvocation(request({ region: "eu" }));
  assert.equal(invocation.outbound.url, "https://eu.posthog.com/api/projects/42/query/");
});

test("transport invocation and result artifacts are deterministic and deeply frozen", () => {
  const spec = request();
  const first = simulatePostHogProductEventsTransport(spec, fixture({
    columns: ["event", "samples"],
    results: [["signup", 2]],
    hasMore: false,
  }));
  const second = simulatePostHogProductEventsTransport(spec, fixture({
    columns: ["event", "samples"],
    results: [["signup", 2]],
    hasMore: false,
  }));

  assert.deepEqual(first, second);
  assert.match(first.id, /^posthog_fixture_result_[a-f0-9]{16}$/);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.invocation), true);
  assert.equal(Object.isFrozen(first.invocation.outbound), true);
  assert.equal(Object.isFrozen(first.fixture), true);
  assert.equal(Object.isFrozen(first.aggregate), true);
  assert.equal(Object.isFrozen(first.aggregate.rows), true);
  assert.equal(Object.isFrozen(first.aggregate.rows[0]), true);
});

test("successful fixture simulation normalizes the provider payload without persisting raw response text", () => {
  const result = simulatePostHogProductEventsTransport(request(), fixture({
    columns: ["event", "samples"],
    results: [["$pageview", 12], ["checkout_completed", 4]],
    provider_debug: "DROP_ME",
    hasMore: false,
  }));

  assert.equal(result.schema, "solvelang.self-driving.posthog-transport-simulation.v0");
  assert.equal(result.execution.status, "complete");
  assert.equal(result.execution.fixtureResponsesConsumed, 1);
  assert.equal(result.execution.networkRequests, 0);
  assert.equal(result.execution.credentialResolutions, 0);
  assert.equal(result.policy.rawResponsePersisted, false);
  assert.equal(result.aggregate.coverage, "complete");
  assert.deepEqual(result.aggregate.rows.map((row) => [row.event, row.samples]), [
    ["$pageview", 12],
    ["checkout_completed", 4],
  ]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("DROP_ME"), false);
  assert.equal(serialized.includes("bodyText\":\"{\\\"columns"), false);
});

test("fixture transport bounds are checked before JSON parsing", () => {
  const spec = request({
    bounds: {
      maxPages: 1,
      maxRecords: 5,
      maxResponseBytes: 64,
      maxRequests: 1,
      timeoutMs: 1_000,
      lookbackMinutes: 60,
    },
  });
  const invalidOversizedJson = "{" + "x".repeat(200);

  assert.throws(
    () => simulatePostHogProductEventsTransport(spec, fixture({}, { bodyText: invalidOversizedJson })),
    /64-byte response bound/,
  );
});

test("fixture simulation rejects timeout overruns before parsing", () => {
  const spec = request({
    bounds: {
      maxPages: 1,
      maxRecords: 5,
      maxResponseBytes: 2_000,
      maxRequests: 1,
      timeoutMs: 250,
      lookbackMinutes: 60,
    },
  });
  assert.throws(
    () => simulatePostHogProductEventsTransport(spec, fixture({ results: [] }, { elapsedMs: 251 })),
    /250ms timeout bound/,
  );
});

test("fixture simulation models exactly one request and one terminal response with no retry or polling authority", () => {
  const spec = request();
  for (const counts of [
    { requestCount: 2 },
    { responseCount: 2 },
    { requestCount: 0 },
    { responseCount: 0 },
  ]) {
    assert.throws(
      () => simulatePostHogProductEventsTransport(spec, fixture({ results: [] }, counts)),
      /exactly one request and one terminal response/,
    );
  }
});

test("fixture simulation rejects async, redirect, and error HTTP statuses", () => {
  const spec = request();
  for (const status of [202, 301, 302, 400, 401, 403, 429, 500]) {
    assert.throws(
      () => simulatePostHogProductEventsTransport(spec, fixture({ results: [] }, { status })),
      new RegExp(`terminal HTTP 200 responses; received ${status}`),
    );
  }
});

test("fixture simulation rejects invalid JSON after transport bounds pass", () => {
  assert.throws(
    () => simulatePostHogProductEventsTransport(request(), fixture({}, { bodyText: "{not-json" })),
    /valid JSON after transport bounds pass/,
  );
});

test("fixture simulation delegates malformed aggregate data to the strict query-result normalizer", () => {
  assert.throws(
    () => simulatePostHogProductEventsTransport(request(), fixture({
      columns: ["distinct_id", "samples"],
      results: [["person-42", 1]],
    })),
    /columns must be exactly event,samples/,
  );
});

test("fixture simulation preserves provider and query-limit partiality", () => {
  const providerPartial = simulatePostHogProductEventsTransport(request(), fixture({
    results: [["signup", 2]],
    hasMore: true,
  }));
  assert.equal(providerPartial.aggregate.coverage, "partial");
  assert.deepEqual(providerPartial.aggregate.partialReasons, ["provider-has-more"]);

  const queryLimited = simulatePostHogProductEventsTransport(request(), fixture({
    results: [["a", 5], ["b", 4], ["c", 3], ["d", 2], ["e", 1]],
    hasMore: false,
  }));
  assert.equal(queryLimited.aggregate.coverage, "partial");
  assert.deepEqual(queryLimited.aggregate.partialReasons, ["query-limit"]);
});

test("fixture envelope rejects unknown fields instead of accepting hidden transport controls", () => {
  assert.throws(
    () => simulatePostHogProductEventsTransport(request(), fixture({ results: [] }, {
      url: "https://evil.invalid",
    })),
    /unsupported fields: url/,
  );
});

test("serialized invocation/result expose no credential value or Authorization header", () => {
  const result = simulatePostHogProductEventsTransport(request(), fixture({ results: [["signup", 1]] }));
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes("phx_live_"), false);
  assert.equal(serialized.includes("Bearer "), false);
  assert.equal(serialized.includes("Authorization"), false);
  assert.ok(serialized.includes("env:POSTHOG_READ_ONLY_TOKEN"));
});

test("request integrity rejects frozen tampering of host, path, credential scope, query values, and request ID", () => {
  const canonical = request();
  const variants: PostHogAggregateQueryRequest[] = [
    freezeForgedRequest({
      ...canonical,
      request: { ...canonical.request, host: "https://eu.posthog.com" },
    }),
    freezeForgedRequest({
      ...canonical,
      request: { ...canonical.request, path: "/api/projects/99/query/" },
    }),
    freezeForgedRequest({
      ...canonical,
      request: {
        ...canonical.request,
        authorization: {
          ...canonical.request.authorization,
          requiredScopes: ["query:write"] as unknown as readonly ["query:read"],
        },
      },
    }),
    freezeForgedRequest({
      ...canonical,
      request: {
        ...canonical.request,
        body: {
          query: {
            ...canonical.request.body.query,
            values: { ...canonical.request.body.query.values, max_records: 999 },
          },
        },
      },
    }),
    freezeForgedRequest({ ...canonical, id: "posthog_query_0000000000000000" }),
  ];

  for (const forged of variants) {
    assert.throws(
      () => createPostHogTransportSimulationInvocation(forged),
      /integrity check failed/,
    );
  }
});

test("transport simulation exposes no network-capable callback or credential resolver surface", () => {
  const invocation = createPostHogTransportSimulationInvocation(request());
  const serialized = JSON.stringify(invocation);

  assert.equal(invocation.execution.networkRequests, 0);
  assert.equal(invocation.execution.credentialResolutions, 0);
  assert.equal(invocation.policy.networkAccess, false);
  assert.equal(invocation.policy.credentialResolution, false);
  assert.equal(serialized.includes("callback"), false);
  assert.equal(serialized.includes("resolver"), false);
  assert.equal(serialized.includes("fetch"), false);
});
