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
const expectedColumns = ["event", "samples"] as const;
const maxEventLength = 256;

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

function deepFreezeRequest(request: PostHogAggregateQueryRequest): PostHogAggregateQueryRequest {
  Object.freeze(request.tenant);
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
  if (!Number.isSafeInteger(projectId) || projectId < 1) {
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

function assertObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
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
  if (!request || typeof request !== "object" || !Object.isFrozen(request)) {
    throw new Error("PostHog aggregate response normalization requires the immutable request contract.");
  }
  if (request.schema !== "solvelang.self-driving.posthog-query-request.v0" || request.capability !== "product-events") {
    throw new Error("PostHog aggregate response normalization requires a product-events query request.");
  }
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
