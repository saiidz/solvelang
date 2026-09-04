import {
  createPostHogReadIntent,
  type ProviderConnectionPlan,
  type ProviderRegion,
} from "./selfDrivingProviderConnection";
import {
  adaptSanitizedPostHogExport,
  type PostHogOfflineAdapterResult,
  type PostHogSanitizedExportRecord,
  type PostHogSanitizedExportV0,
} from "./selfDrivingPosthogExport";

export type PostHogAggregateQueryRequest = {
  schema: "solvelang.self-driving.posthog-query-request.v0";
  mode: "analyze-only";
  id: string;
  connectionPlanId: string;
  provider: "posthog";
  capability: "product-events";
  region: ProviderRegion;
  tenant: {
    projectLocator: string;
    projectId: number;
  };
  transportBounds: {
    maxPages: number;
    maxResponseBytes: number;
    maxRequests: number;
    timeoutMs: number;
  };
  request: {
    host: "https://us.posthog.com" | "https://eu.posthog.com";
    path: string;
    method: "POST";
    contentType: "application/json";
    authorization: {
      scheme: "bearer";
      credentialRef: string;
      resolved: false;
      requiredScopes: readonly ["query:read"];
    };
    body: {
      query: {
        kind: "HogQLQuery";
        name: "solvelang_product_event_summary_v0";
        query: string;
        values: {
          lookback_minutes: number;
          max_records: number;
        };
      };
    };
  };
  execution: {
    status: "not-executed";
    networkRequests: 0;
    credentialResolutions: 0;
  };
  policy: {
    fixedHost: true;
    fixedPath: true;
    fixedMethod: true;
    callerSuppliedSql: false;
    parameterizedValuesOnly: true;
    personIdentitySelected: false;
    sessionIdentitySelected: false;
    arbitraryUrlAccess: false;
    arbitraryMethodAccess: false;
    mutationEndpointAccess: false;
    networkAccess: false;
    credentialResolution: false;
    externalSideEffects: false;
  };
};

export type PostHogAggregateResultRow = {
  id: string;
  event: string;
  samples: number;
};

export type PostHogAggregateQueryResult = {
  schema: "solvelang.self-driving.posthog-query-result.v0";
  mode: "analyze-only";
  requestId: string;
  connectionPlanId: string;
  source: {
    provider: "posthog";
    projectLocator: string;
    region: ProviderRegion;
  };
  coverage: "complete" | "partial";
  partialReasons: Array<"provider-has-more" | "query-limit">;
  columns: readonly ["event", "samples"];
  rows: PostHogAggregateResultRow[];
  execution: {
    inputRows: number;
    emittedRows: number;
    metadataDropped: true;
  };
  policy: {
    sanitizedAggregatesOnly: true;
    personIdentityAccess: false;
    sessionIdentityAccess: false;
    rawBodyAccess: false;
    credentialAccess: false;
    externalSideEffects: false;
  };
};

export type CompletePostHogAggregateBridge = {
  schema: "solvelang.self-driving.posthog-query-context-bridge.v0";
  mode: "analyze-only";
  requestId: string;
  observationTimestamp: string;
  adapter: PostHogOfflineAdapterResult;
};

const hostsByRegion: Record<ProviderRegion, PostHogAggregateQueryRequest["request"]["host"]> = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
};

const HOGQL_QUERY = "SELECT event, count() AS samples FROM events WHERE timestamp >= now() - toIntervalMinute({lookback_minutes}) GROUP BY event ORDER BY samples DESC LIMIT {max_records}";
const expectedColumns = Object.freeze(["event", "samples"] as const);
const maxEventLength = 256;
const maxProjectId = Number.MAX_SAFE_INTEGER;
const maxTransportPages = 100;
const maxTransportResponseBytes = 20 * 1024 * 1024;
const maxTransportRequests = 100;
const maxTransportTimeoutMs = 60_000;
const maxQueryRecords = 5_000;
const maxQueryLookbackMinutes = 30 * 24 * 60;

const emailValuePattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ipv4ValuePattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const sensitiveValuePatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
];

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

function assertObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key)).sort(compareText);
  if (unknown.length > 0) throw new Error(`${name} contains unsupported fields: ${unknown.join(", ")}.`);
}

function deepFreezeRequest(request: PostHogAggregateQueryRequest): PostHogAggregateQueryRequest {
  Object.freeze(request.tenant);
  Object.freeze(request.transportBounds);
  Object.freeze(request.request.authorization.requiredScopes);
  Object.freeze(request.request.authorization);
  Object.freeze(request.request.body.query.values);
  Object.freeze(request.request.body.query);
  Object.freeze(request.request.body);
  Object.freeze(request.request);
  Object.freeze(request.execution);
  Object.freeze(request.policy);
  return Object.freeze(request);
}

function parseNumericProjectLocator(projectLocator: string): number {
  const match = /^project:([1-9][0-9]{0,15})$/.exec(projectLocator);
  if (!match) {
    throw new Error("PostHog query requests require tenant.projectLocator to use exact numeric project:<id> syntax.");
  }
  const projectId = Number(match[1]);
  if (!Number.isSafeInteger(projectId) || projectId < 1 || projectId > maxProjectId) {
    throw new Error("PostHog project ID must be a positive safe integer.");
  }
  return projectId;
}

function requestIdentity(request: Omit<PostHogAggregateQueryRequest, "id">): string {
  return JSON.stringify(request);
}

export function createPostHogProductEventsQueryRequest(
  plan: ProviderConnectionPlan,
): PostHogAggregateQueryRequest {
  const intent = createPostHogReadIntent(plan, "product-events");
  const projectId = parseNumericProjectLocator(intent.tenant.projectLocator);

  const requestWithoutId: Omit<PostHogAggregateQueryRequest, "id"> = {
    schema: "solvelang.self-driving.posthog-query-request.v0",
    mode: "analyze-only",
    connectionPlanId: intent.connectionPlanId,
    provider: "posthog",
    capability: "product-events",
    region: intent.region,
    tenant: {
      projectLocator: intent.tenant.projectLocator,
      projectId,
    },
    transportBounds: {
      maxPages: intent.bounds.maxPages,
      maxResponseBytes: intent.bounds.maxResponseBytes,
      maxRequests: intent.bounds.maxRequests,
      timeoutMs: intent.bounds.timeoutMs,
    },
    request: {
      host: hostsByRegion[intent.region],
      path: `/api/projects/${projectId}/query/`,
      method: "POST",
      contentType: "application/json",
      authorization: {
        scheme: "bearer",
        credentialRef: plan.credential.reference,
        resolved: false,
        requiredScopes: ["query:read"],
      },
      body: {
        query: {
          kind: "HogQLQuery",
          name: "solvelang_product_event_summary_v0",
          query: HOGQL_QUERY,
          values: {
            lookback_minutes: intent.bounds.lookbackMinutes,
            max_records: intent.bounds.maxRecords,
          },
        },
      },
    },
    execution: {
      status: "not-executed",
      networkRequests: 0,
      credentialResolutions: 0,
    },
    policy: {
      fixedHost: true,
      fixedPath: true,
      fixedMethod: true,
      callerSuppliedSql: false,
      parameterizedValuesOnly: true,
      personIdentitySelected: false,
      sessionIdentitySelected: false,
      arbitraryUrlAccess: false,
      arbitraryMethodAccess: false,
      mutationEndpointAccess: false,
      networkAccess: false,
      credentialResolution: false,
      externalSideEffects: false,
    },
  };

  return deepFreezeRequest({
    ...requestWithoutId,
    id: `posthog_query_${stableHash(requestIdentity(requestWithoutId))}`,
  });
}

function assertPositiveBound(value: unknown, name: string, maximum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`${name} must be a positive safe integer no greater than ${maximum}.`);
  }
}

export function assertPostHogProductEventsQueryRequestIntegrity(
  request: PostHogAggregateQueryRequest,
): PostHogAggregateQueryRequest {
  if (!request || typeof request !== "object" || !Object.isFrozen(request)) {
    throw new Error("PostHog query request integrity check requires the immutable request contract.");
  }

  const raw = request as unknown as Record<string, unknown>;
  assertExactKeys(raw, ["schema", "mode", "id", "connectionPlanId", "provider", "capability", "region", "tenant", "transportBounds", "request", "execution", "policy"], "PostHog query request");
  if (request.schema !== "solvelang.self-driving.posthog-query-request.v0" || request.mode !== "analyze-only") {
    throw new Error("PostHog query request integrity check failed.");
  }
  if (request.provider !== "posthog" || request.capability !== "product-events") {
    throw new Error("PostHog query request integrity check failed.");
  }
  if (request.region !== "us" && request.region !== "eu") throw new Error("PostHog query request integrity check failed.");

  assertObject(request.tenant, "PostHog query request tenant");
  assertExactKeys(request.tenant, ["projectLocator", "projectId"], "PostHog query request tenant");
  const projectId = parseNumericProjectLocator(request.tenant.projectLocator);
  if (request.tenant.projectId !== projectId) throw new Error("PostHog query request integrity check failed.");

  assertObject(request.transportBounds, "PostHog query request transportBounds");
  assertExactKeys(request.transportBounds, ["maxPages", "maxResponseBytes", "maxRequests", "timeoutMs"], "PostHog query request transportBounds");
  assertPositiveBound(request.transportBounds.maxPages, "transportBounds.maxPages", maxTransportPages);
  assertPositiveBound(request.transportBounds.maxResponseBytes, "transportBounds.maxResponseBytes", maxTransportResponseBytes);
  assertPositiveBound(request.transportBounds.maxRequests, "transportBounds.maxRequests", maxTransportRequests);
  assertPositiveBound(request.transportBounds.timeoutMs, "transportBounds.timeoutMs", maxTransportTimeoutMs);
  if (request.transportBounds.maxPages > request.transportBounds.maxRequests) throw new Error("PostHog query request integrity check failed.");

  assertObject(request.request, "PostHog query request transport");
  assertExactKeys(request.request, ["host", "path", "method", "contentType", "authorization", "body"], "PostHog query request transport");
  if (request.request.host !== hostsByRegion[request.region]) throw new Error("PostHog query request integrity check failed.");
  if (request.request.path !== `/api/projects/${projectId}/query/` || request.request.method !== "POST" || request.request.contentType !== "application/json") {
    throw new Error("PostHog query request integrity check failed.");
  }

  assertObject(request.request.authorization, "PostHog query request authorization");
  assertExactKeys(request.request.authorization, ["scheme", "credentialRef", "resolved", "requiredScopes"], "PostHog query request authorization");
  if (request.request.authorization.scheme !== "bearer" || request.request.authorization.resolved !== false) throw new Error("PostHog query request integrity check failed.");
  if (!/^env:[A-Z][A-Z0-9_]{1,127}$/.test(request.request.authorization.credentialRef)) throw new Error("PostHog query request integrity check failed.");
  if (!Array.isArray(request.request.authorization.requiredScopes) || request.request.authorization.requiredScopes.length !== 1 || request.request.authorization.requiredScopes[0] !== "query:read") {
    throw new Error("PostHog query request integrity check failed.");
  }

  assertObject(request.request.body, "PostHog query request body");
  assertExactKeys(request.request.body, ["query"], "PostHog query request body");
  assertObject(request.request.body.query, "PostHog query request body.query");
  assertExactKeys(request.request.body.query, ["kind", "name", "query", "values"], "PostHog query request body.query");
  if (request.request.body.query.kind !== "HogQLQuery" || request.request.body.query.name !== "solvelang_product_event_summary_v0" || request.request.body.query.query !== HOGQL_QUERY) {
    throw new Error("PostHog query request integrity check failed.");
  }
  assertObject(request.request.body.query.values, "PostHog query request body.query.values");
  assertExactKeys(request.request.body.query.values, ["lookback_minutes", "max_records"], "PostHog query request body.query.values");
  assertPositiveBound(request.request.body.query.values.lookback_minutes, "query.values.lookback_minutes", maxQueryLookbackMinutes);
  assertPositiveBound(request.request.body.query.values.max_records, "query.values.max_records", maxQueryRecords);

  if (
    request.execution.status !== "not-executed"
    || request.execution.networkRequests !== 0
    || request.execution.credentialResolutions !== 0
    || request.policy.fixedHost !== true
    || request.policy.fixedPath !== true
    || request.policy.fixedMethod !== true
    || request.policy.callerSuppliedSql !== false
    || request.policy.parameterizedValuesOnly !== true
    || request.policy.personIdentitySelected !== false
    || request.policy.sessionIdentitySelected !== false
    || request.policy.arbitraryUrlAccess !== false
    || request.policy.arbitraryMethodAccess !== false
    || request.policy.mutationEndpointAccess !== false
    || request.policy.networkAccess !== false
    || request.policy.credentialResolution !== false
    || request.policy.externalSideEffects !== false
  ) {
    throw new Error("PostHog query request integrity check failed.");
  }

  const { id, ...withoutId } = request;
  const expectedId = `posthog_query_${stableHash(requestIdentity(withoutId))}`;
  if (id !== expectedId) throw new Error("PostHog query request integrity check failed.");
  return request;
}

function normalizeEvent(value: unknown, rowIndex: number): string {
  if (typeof value !== "string") throw new Error(`results[${rowIndex}][0] event must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`results[${rowIndex}][0] event must not be empty.`);
  if (normalized.length > maxEventLength) throw new Error(`results[${rowIndex}][0] event exceeds the ${maxEventLength}-character bound.`);
  if (/[\r\n\u0000-\u001f]/.test(normalized)) {
    throw new Error(`results[${rowIndex}][0] event must be sanitized single-line text.`);
  }
  if (emailValuePattern.test(normalized) || ipv4ValuePattern.test(normalized)) {
    throw new Error(`results[${rowIndex}][0] event appears to contain person/network identity.`);
  }
  if (sensitiveValuePatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error(`results[${rowIndex}][0] event appears to contain credential or secret material.`);
  }
  return normalized;
}

function normalizeSamples(value: unknown, rowIndex: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`results[${rowIndex}][1] samples must be a non-negative safe integer.`);
  }
  return value as number;
}

function normalizeColumns(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== expectedColumns.length) {
    throw new Error("PostHog aggregate response columns must be exactly event,samples when present.");
  }
  if (value[0] !== expectedColumns[0] || value[1] !== expectedColumns[1]) {
    throw new Error("PostHog aggregate response columns must be exactly event,samples when present.");
  }
}

export function normalizePostHogProductEventsQueryResult(
  request: PostHogAggregateQueryRequest,
  raw: unknown,
): PostHogAggregateQueryResult {
  assertPostHogProductEventsQueryRequestIntegrity(request);
  assertObject(raw, "PostHog aggregate response");
  normalizeColumns(raw.columns);
  if (!Array.isArray(raw.results)) throw new Error("PostHog aggregate response results must be an array.");
  if (raw.results.length > request.request.body.query.values.max_records) {
    throw new Error("PostHog aggregate response exceeds the request max_records bound.");
  }
  if (raw.hasMore !== undefined && typeof raw.hasMore !== "boolean") {
    throw new Error("PostHog aggregate response hasMore must be a boolean when present.");
  }

  const seenEvents = new Set<string>();
  const rows = raw.results.map((rawRow, rowIndex): PostHogAggregateResultRow => {
    if (!Array.isArray(rawRow) || rawRow.length !== 2) {
      throw new Error(`results[${rowIndex}] must be exactly [event, samples].`);
    }
    const event = normalizeEvent(rawRow[0], rowIndex);
    if (seenEvents.has(event)) throw new Error(`PostHog aggregate response contains duplicate event row: ${event}`);
    seenEvents.add(event);
    const samples = normalizeSamples(rawRow[1], rowIndex);
    return {
      id: `posthog_event_${stableHash(JSON.stringify([event, samples]))}`,
      event,
      samples,
    };
  }).sort((left, right) => right.samples - left.samples || compareText(left.event, right.event));

  const partialReasons: PostHogAggregateQueryResult["partialReasons"] = [];
  if (raw.hasMore === true) partialReasons.push("provider-has-more");
  if (rows.length >= request.request.body.query.values.max_records) partialReasons.push("query-limit");

  return {
    schema: "solvelang.self-driving.posthog-query-result.v0",
    mode: "analyze-only",
    requestId: request.id,
    connectionPlanId: request.connectionPlanId,
    source: {
      provider: "posthog",
      projectLocator: request.tenant.projectLocator,
      region: request.region,
    },
    coverage: partialReasons.length > 0 ? "partial" : "complete",
    partialReasons,
    columns: expectedColumns,
    rows,
    execution: {
      inputRows: raw.results.length,
      emittedRows: rows.length,
      metadataDropped: true,
    },
    policy: {
      sanitizedAggregatesOnly: true,
      personIdentityAccess: false,
      sessionIdentityAccess: false,
      rawBodyAccess: false,
      credentialAccess: false,
      externalSideEffects: false,
    },
  };
}

function normalizeObservationTimestamp(value: string): string {
  if (typeof value !== "string") throw new Error("observationTimestamp must be a string.");
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 64) {
    throw new Error("observationTimestamp must be a bounded non-empty timestamp.");
  }
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new Error("observationTimestamp must be a valid timestamp.");
  return parsed.toISOString();
}

export function bridgeCompletePostHogProductEventsResultToContext(
  result: PostHogAggregateQueryResult,
  observationTimestamp: string,
): CompletePostHogAggregateBridge {
  if (result.coverage !== "complete") {
    throw new Error("Partial PostHog aggregate results cannot enter Solve Context until an exact skipped-row count is available; completeness is not inferred.");
  }
  const observedAt = normalizeObservationTimestamp(observationTimestamp);
  const records: PostHogSanitizedExportRecord[] = result.rows.map((row) => ({
    kind: "event",
    locator: `event-aggregate:${stableHash(row.event)}`,
    observedAt,
    summary: `Sanitized aggregate count observed for PostHog event '${row.event}'.`,
    dimensions: { event: row.event },
    metrics: { samples: row.samples },
    sanitized: true,
  }));
  const input: PostHogSanitizedExportV0 = {
    schema: "solvelang.posthog.sanitized-export.v0",
    sanitized: true,
    source: {
      projectLocator: result.source.projectLocator,
      exportLocator: `query-result:${result.requestId}`,
      coverage: "complete",
    },
    records,
  };
  const adapter = adaptSanitizedPostHogExport(input);

  return {
    schema: "solvelang.self-driving.posthog-query-context-bridge.v0",
    mode: "analyze-only",
    requestId: result.requestId,
    observationTimestamp: observedAt,
    adapter,
  };
}
