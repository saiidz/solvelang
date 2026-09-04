import {
  assertPostHogProductEventsQueryRequestIntegrity,
  normalizePostHogProductEventsQueryResult,
  type PostHogAggregateQueryRequest,
  type PostHogAggregateQueryResult,
} from "./selfDrivingPosthogQueryContract";

export type PostHogTransportSimulationFixture = {
  schema: "solvelang.self-driving.posthog-transport-fixture.v0";
  status: number;
  elapsedMs: number;
  requestCount: number;
  responseCount: number;
  bodyText: string;
};

export type PostHogTransportSimulationInvocation = {
  schema: "solvelang.self-driving.posthog-transport-invocation.v0";
  mode: "analyze-only";
  id: string;
  requestId: string;
  outbound: {
    method: "POST";
    url: string;
    contentType: "application/json";
    authorization: {
      scheme: "bearer";
      credentialRef: string;
      resolved: false;
      requiredScopes: readonly ["query:read"];
    };
    bodyText: string;
    bodyBytes: number;
  };
  bounds: {
    maxPages: number;
    maxResponseBytes: number;
    maxRequests: number;
    timeoutMs: number;
  };
  execution: {
    status: "fixture-only";
    networkRequests: 0;
    credentialResolutions: 0;
  };
  policy: {
    fixtureOnly: true;
    exactRequestOnly: true;
    arbitraryUrlAccess: false;
    arbitraryMethodAccess: false;
    networkAccess: false;
    credentialResolution: false;
    externalSideEffects: false;
  };
};

export type PostHogTransportSimulationResult = {
  schema: "solvelang.self-driving.posthog-transport-simulation.v0";
  mode: "analyze-only";
  id: string;
  invocation: PostHogTransportSimulationInvocation;
  fixture: {
    status: 200;
    elapsedMs: number;
    requestCount: 1;
    responseCount: 1;
    responseBytes: number;
  };
  aggregate: PostHogAggregateQueryResult;
  execution: {
    status: "complete";
    fixtureResponsesConsumed: 1;
    networkRequests: 0;
    credentialResolutions: 0;
  };
  policy: {
    fixtureOnly: true;
    rawResponsePersisted: false;
    networkAccess: false;
    credentialResolution: false;
    externalSideEffects: false;
  };
};

const fixtureKeys = ["schema", "status", "elapsedMs", "requestCount", "responseCount", "bodyText"] as const;
const maxOutboundBodyBytes = 16 * 1024;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableHash(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul((left ^ code) >>> 0, 0x01000193) >>> 0;
    right = Math.imul((right ^ ((code + index) >>> 0)) >>> 0, 0x85ebca6b) >>> 0;
  }
  return left.toString(16).padStart(8, "0") + right.toString(16).padStart(8, "0");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key)).sort(compareText);
  if (unknown.length > 0) throw new Error(`${name} contains unsupported fields: ${unknown.join(", ")}.`);
}

function assertNonNegativeSafeInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${name} must be a non-negative safe integer.`);
}

function freezeInvocation(invocation: PostHogTransportSimulationInvocation): PostHogTransportSimulationInvocation {
  Object.freeze(invocation.outbound.authorization.requiredScopes);
  Object.freeze(invocation.outbound.authorization);
  Object.freeze(invocation.outbound);
  Object.freeze(invocation.bounds);
  Object.freeze(invocation.execution);
  Object.freeze(invocation.policy);
  return Object.freeze(invocation);
}

function freezeAggregate(result: PostHogAggregateQueryResult): PostHogAggregateQueryResult {
  for (const row of result.rows) Object.freeze(row);
  Object.freeze(result.rows);
  Object.freeze(result.partialReasons);
  Object.freeze(result.source);
  Object.freeze(result.execution);
  Object.freeze(result.policy);
  return Object.freeze(result);
}

function freezeResult(result: PostHogTransportSimulationResult): PostHogTransportSimulationResult {
  Object.freeze(result.fixture);
  freezeAggregate(result.aggregate);
  Object.freeze(result.execution);
  Object.freeze(result.policy);
  return Object.freeze(result);
}

export function createPostHogTransportSimulationInvocation(
  request: PostHogAggregateQueryRequest,
): PostHogTransportSimulationInvocation {
  const canonicalRequest = assertPostHogProductEventsQueryRequestIntegrity(request);
  const bodyText = JSON.stringify(canonicalRequest.request.body);
  const bodyBytes = byteLength(bodyText);
  if (bodyBytes > maxOutboundBodyBytes) {
    throw new Error(`PostHog query request body exceeds the ${maxOutboundBodyBytes}-byte simulation safety bound.`);
  }

  const withoutId: Omit<PostHogTransportSimulationInvocation, "id"> = {
    schema: "solvelang.self-driving.posthog-transport-invocation.v0",
    mode: "analyze-only",
    requestId: canonicalRequest.id,
    outbound: {
      method: "POST",
      url: `${canonicalRequest.request.host}${canonicalRequest.request.path}`,
      contentType: "application/json",
      authorization: {
        scheme: "bearer",
        credentialRef: canonicalRequest.request.authorization.credentialRef,
        resolved: false,
        requiredScopes: ["query:read"],
      },
      bodyText,
      bodyBytes,
    },
    bounds: { ...canonicalRequest.transportBounds },
    execution: {
      status: "fixture-only",
      networkRequests: 0,
      credentialResolutions: 0,
    },
    policy: {
      fixtureOnly: true,
      exactRequestOnly: true,
      arbitraryUrlAccess: false,
      arbitraryMethodAccess: false,
      networkAccess: false,
      credentialResolution: false,
      externalSideEffects: false,
    },
  };

  return freezeInvocation({
    ...withoutId,
    id: `posthog_fixture_invocation_${stableHash(JSON.stringify(withoutId))}`,
  });
}

function normalizeFixture(
  request: PostHogAggregateQueryRequest,
  fixture: unknown,
): PostHogTransportSimulationResult["fixture"] & { bodyText: string } {
  assertObject(fixture, "PostHog transport fixture");
  assertExactKeys(fixture, fixtureKeys, "PostHog transport fixture");
  if (fixture.schema !== "solvelang.self-driving.posthog-transport-fixture.v0") {
    throw new Error("Unsupported PostHog transport fixture schema.");
  }
  assertNonNegativeSafeInteger(fixture.status, "fixture.status");
  if (fixture.status !== 200) {
    throw new Error(`PostHog transport simulation accepts only terminal HTTP 200 responses; received ${fixture.status}.`);
  }
  assertNonNegativeSafeInteger(fixture.elapsedMs, "fixture.elapsedMs");
  if (fixture.elapsedMs > request.transportBounds.timeoutMs) {
    throw new Error(`PostHog transport fixture exceeded the ${request.transportBounds.timeoutMs}ms timeout bound.`);
  }
  assertNonNegativeSafeInteger(fixture.requestCount, "fixture.requestCount");
  assertNonNegativeSafeInteger(fixture.responseCount, "fixture.responseCount");
  if (fixture.requestCount !== 1 || fixture.responseCount !== 1) {
    throw new Error("PostHog transport simulation models exactly one request and one terminal response; polling/retries are not enabled.");
  }
  if (fixture.requestCount > request.transportBounds.maxRequests) {
    throw new Error("PostHog transport fixture exceeds the request-count bound.");
  }
  if (typeof fixture.bodyText !== "string") throw new Error("fixture.bodyText must be a string.");
  const responseBytes = byteLength(fixture.bodyText);
  if (responseBytes > request.transportBounds.maxResponseBytes) {
    throw new Error(`PostHog transport fixture exceeds the ${request.transportBounds.maxResponseBytes}-byte response bound.`);
  }

  return {
    status: 200,
    elapsedMs: fixture.elapsedMs,
    requestCount: 1,
    responseCount: 1,
    responseBytes,
    bodyText: fixture.bodyText,
  };
}

export function simulatePostHogProductEventsTransport(
  request: PostHogAggregateQueryRequest,
  fixture: unknown,
): PostHogTransportSimulationResult {
  const canonicalRequest = assertPostHogProductEventsQueryRequestIntegrity(request);
  const invocation = createPostHogTransportSimulationInvocation(canonicalRequest);
  const normalizedFixture = normalizeFixture(canonicalRequest, fixture);

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedFixture.bodyText) as unknown;
  } catch {
    throw new Error("PostHog transport fixture body must contain valid JSON after transport bounds pass.");
  }

  const aggregate = normalizePostHogProductEventsQueryResult(canonicalRequest, parsed);
  const fixtureSummary: PostHogTransportSimulationResult["fixture"] = {
    status: 200,
    elapsedMs: normalizedFixture.elapsedMs,
    requestCount: 1,
    responseCount: 1,
    responseBytes: normalizedFixture.responseBytes,
  };
  const identity = JSON.stringify({
    invocationId: invocation.id,
    fixture: fixtureSummary,
    aggregate,
  });

  return freezeResult({
    schema: "solvelang.self-driving.posthog-transport-simulation.v0",
    mode: "analyze-only",
    id: `posthog_fixture_result_${stableHash(identity)}`,
    invocation,
    fixture: fixtureSummary,
    aggregate,
    execution: {
      status: "complete",
      fixtureResponsesConsumed: 1,
      networkRequests: 0,
      credentialResolutions: 0,
    },
    policy: {
      fixtureOnly: true,
      rawResponsePersisted: false,
      networkAccess: false,
      credentialResolution: false,
      externalSideEffects: false,
    },
  });
}
