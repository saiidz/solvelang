import { POSTHOG_READONLY_CONNECTOR_POLICY } from "./selfDrivingProviderConnector";

export type PostHogCloudRegion = "us" | "eu";

export type PostHogPlannerOrigin =
  | { kind: "cloud"; region: PostHogCloudRegion }
  | { kind: "self-hosted"; origin: string };

export type PostHogGetRequestPlanInput = {
  operation: string;
  tenant: string;
  pageSize: number;
  origin: PostHogPlannerOrigin;
  cursor?: string;
};

export type PostHogGetRequestPlan = {
  schema: "solvelang.self-driving.posthog-get-request.v0";
  mode: "analyze-only";
  id: string;
  provider: "posthog";
  operation: string;
  tenant: {
    projectLocator: string;
    projectId: number;
  };
  source: {
    originKind: "cloud" | "self-hosted";
    origin: string;
  };
  request: {
    origin: string;
    path: string;
    method: "GET";
    query: {
      limit: number;
      offset?: number;
    };
    body: null;
  };
  audit: {
    pathTemplate: string;
    tenantField: "project";
    paginationKeys: readonly ["limit", "offset"];
    deterministic: true;
    redacted: true;
  };
  execution: {
    status: "not-executed";
    networkRequests: 0;
    credentialResolutions: 0;
    authorizationCallbacksInvoked: 0;
  };
  policy: {
    readOnly: true;
    fixedMethod: true;
    bodyAllowed: false;
    allowlistedPathOnly: true;
    arbitraryUrlAccess: false;
    cursorOriginChangesAllowed: false;
    cursorPathChangesAllowed: false;
    credentialReferencesPersisted: false;
    authorizationHeadersPersisted: false;
    headerInjectionDeferred: true;
    networkAccess: false;
    externalSideEffects: false;
  };
};

export type PostHogEphemeralAuthorizationInjector = (
  request: Readonly<{
    requestId: string;
    method: "GET";
    origin: string;
    path: string;
    query: Readonly<{ limit: number; offset?: number }>;
  }>,
) => Promise<Readonly<Record<string, string>>>;

const cloudOrigins: Record<PostHogCloudRegion, string> = Object.freeze({
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
});

const paginationKeys = Object.freeze(["limit", "offset"] as const);
const maxOriginLength = 512;
const maxCursorLength = 1_024;
const maxTenantLength = 64;

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

function normalizeText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character bound.`);
  if (/[\r\n\u0000-\u001f]/.test(normalized)) throw new Error(`${name} must be single-line sanitized text.`);
  return normalized;
}

function assertPositiveSafeInteger(value: unknown, name: string, maximum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`${name} must be a positive safe integer no greater than ${maximum}.`);
  }
}

function parseProjectLocator(value: unknown): { projectLocator: string; projectId: number } {
  const projectLocator = normalizeText(value, "tenant", maxTenantLength);
  const match = /^project:([1-9][0-9]{0,15})$/.exec(projectLocator);
  if (!match) throw new Error("PostHog requests require tenant to use exact numeric project:<id> syntax.");
  const projectId = Number(match[1]);
  if (!Number.isSafeInteger(projectId) || projectId < 1) throw new Error("PostHog project ID must be a positive safe integer.");
  return { projectLocator, projectId };
}

function isIpv4Literal(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  return parts.every((part) => Number(part) <= 255);
}

function isStrictDnsHostname(hostname: string): boolean {
  if (hostname.length > 253 || hostname.endsWith(".")) return false;
  const labels = hostname.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}

function validateSelfHostedOrigin(rawValue: unknown): string {
  const raw = normalizeText(rawValue, "origin.origin", maxOriginLength);
  if (raw.includes("\\") || /(?:\/\.\.(?:\/|$)|\/%2e)/i.test(raw)) {
    throw new Error("Self-hosted PostHog origin must not contain path traversal or backslashes.");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Self-hosted PostHog origin must be an absolute HTTPS origin.");
  }

  if (parsed.protocol !== "https:") throw new Error("Self-hosted PostHog origin must use HTTPS.");
  if (parsed.username || parsed.password) throw new Error("Self-hosted PostHog origin must not contain userinfo.");
  if (parsed.search) throw new Error("Self-hosted PostHog origin must not contain a query string.");
  if (parsed.hash) throw new Error("Self-hosted PostHog origin must not contain a fragment.");
  if (parsed.pathname !== "/") throw new Error("Self-hosted PostHog origin must not contain an application path.");

  const hostname = parsed.hostname.toLowerCase();
  if (hostname.includes(":") || isIpv4Literal(hostname)) throw new Error("Self-hosted PostHog origin must not use an IP-literal host.");
  if (!isStrictDnsHostname(hostname)) throw new Error("Self-hosted PostHog origin must use a strict DNS hostname.");
  return parsed.origin;
}

function resolveOrigin(rawOrigin: unknown): { originKind: "cloud" | "self-hosted"; origin: string } {
  assertObject(rawOrigin, "origin");
  if (rawOrigin.kind === "cloud") {
    assertExactKeys(rawOrigin, ["kind", "region"], "origin");
    if (rawOrigin.region !== "us" && rawOrigin.region !== "eu") throw new Error("Cloud PostHog origin requires region 'us' or 'eu'.");
    return { originKind: "cloud", origin: cloudOrigins[rawOrigin.region] };
  }
  if (rawOrigin.kind === "self-hosted") {
    assertExactKeys(rawOrigin, ["kind", "origin"], "origin");
    return { originKind: "self-hosted", origin: validateSelfHostedOrigin(rawOrigin.origin) };
  }
  throw new Error("origin.kind must be 'cloud' or 'self-hosted'.");
}

function resolveOperation(operationValue: unknown) {
  const operation = normalizeText(operationValue, "operation", 64);
  const policy = POSTHOG_READONLY_CONNECTOR_POLICY.allowedOperations.find((item) => item.operation === operation);
  if (!policy) throw new Error(`PostHog operation '${operation}' is not allowlisted by the read-only connector policy.`);
  if (policy.provider !== "posthog" || policy.tenantField !== "project" || !operation.startsWith("read-")) {
    throw new Error("PostHog operation policy is not a valid project-bound read operation.");
  }
  return policy;
}

function renderAllowlistedPath(pathTemplate: string, projectId: number, origin: string): string {
  const placeholders = pathTemplate.match(/\{[^}]+\}/g) ?? [];
  if (placeholders.length !== 1 || placeholders[0] !== "{project}") {
    throw new Error("PostHog read path template must contain exactly one {project} placeholder.");
  }
  if (/[?#\\]/.test(pathTemplate) || /(?:^|\/)\.\.(?:\/|$)|%2e|%2f|%5c/i.test(pathTemplate)) {
    throw new Error("PostHog read path template contains unsafe path syntax.");
  }

  const path = pathTemplate.replace("{project}", String(projectId));
  const parsed = new URL(path, origin);
  if (parsed.origin !== origin || parsed.pathname !== path || parsed.search || parsed.hash) {
    throw new Error("PostHog read path escaped its allowlisted origin or path.");
  }
  return path;
}

function parseExactPositiveInteger(value: string | null, name: string, maximum: number): number {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} must be an exact positive decimal integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new Error(`${name} exceeds the allowed bound.`);
  return parsed;
}

function buildPaginationQuery(
  rawCursor: unknown,
  origin: string,
  path: string,
  pageSize: number,
): { limit: number; offset?: number } {
  if (rawCursor === undefined) return { limit: pageSize };
  const cursor = normalizeText(rawCursor, "cursor", maxCursorLength);
  if (cursor.includes("\\") || /%2e|%2f|%5c/i.test(cursor)) throw new Error("PostHog cursor contains unsafe path syntax.");

  let parsed: URL;
  try {
    parsed = new URL(cursor, `${origin}${path}`);
  } catch {
    throw new Error("PostHog cursor must be a valid same-origin pagination reference.");
  }

  if (parsed.username || parsed.password || parsed.hash) throw new Error("PostHog cursor contains forbidden authority or fragment data.");
  if (parsed.origin !== origin) throw new Error("PostHog cursor must not change the request origin.");
  if (parsed.pathname !== path) throw new Error("PostHog cursor must not change the allowlisted request path.");

  const keys = [...parsed.searchParams.keys()];
  if (keys.length !== 2 || keys.some((key) => key !== "limit" && key !== "offset")) {
    throw new Error("PostHog cursor query is limited to exact limit and offset pagination keys.");
  }
  if (parsed.searchParams.getAll("limit").length !== 1 || parsed.searchParams.getAll("offset").length !== 1) {
    throw new Error("PostHog cursor pagination keys must not be duplicated.");
  }

  const limit = parseExactPositiveInteger(parsed.searchParams.get("limit"), "cursor.limit", POSTHOG_READONLY_CONNECTOR_POLICY.maxPageSize);
  if (limit !== pageSize) throw new Error("PostHog cursor limit must match the connector-generated page size.");
  const offset = parseExactPositiveInteger(parsed.searchParams.get("offset"), "cursor.offset", POSTHOG_READONLY_CONNECTOR_POLICY.maxRecords - 1);
  if (offset % pageSize !== 0) throw new Error("PostHog cursor offset must align to the connector-generated page size.");
  return { limit, offset };
}

function deepFreezePlan(plan: PostHogGetRequestPlan): PostHogGetRequestPlan {
  Object.freeze(plan.tenant);
  Object.freeze(plan.source);
  Object.freeze(plan.request.query);
  Object.freeze(plan.request);
  Object.freeze(plan.audit.paginationKeys);
  Object.freeze(plan.audit);
  Object.freeze(plan.execution);
  Object.freeze(plan.policy);
  return Object.freeze(plan);
}

export function createPostHogGetRequestPlan(input: PostHogGetRequestPlanInput): PostHogGetRequestPlan {
  assertObject(input, "PostHog planner input");
  assertExactKeys(input, ["operation", "tenant", "pageSize", "origin", "cursor"], "PostHog planner input");

  const operation = resolveOperation(input.operation);
  const tenant = parseProjectLocator(input.tenant);
  assertPositiveSafeInteger(input.pageSize, "pageSize", POSTHOG_READONLY_CONNECTOR_POLICY.maxPageSize);
  const source = resolveOrigin(input.origin);
  const path = renderAllowlistedPath(operation.pathTemplate, tenant.projectId, source.origin);
  const query = buildPaginationQuery(input.cursor, source.origin, path, input.pageSize);

  const withoutId: Omit<PostHogGetRequestPlan, "id"> = {
    schema: "solvelang.self-driving.posthog-get-request.v0",
    mode: "analyze-only",
    provider: "posthog",
    operation: operation.operation,
    tenant,
    source,
    request: {
      origin: source.origin,
      path,
      method: "GET",
      query,
      body: null,
    },
    audit: {
      pathTemplate: operation.pathTemplate,
      tenantField: "project",
      paginationKeys,
      deterministic: true,
      redacted: true,
    },
    execution: {
      status: "not-executed",
      networkRequests: 0,
      credentialResolutions: 0,
      authorizationCallbacksInvoked: 0,
    },
    policy: {
      readOnly: true,
      fixedMethod: true,
      bodyAllowed: false,
      allowlistedPathOnly: true,
      arbitraryUrlAccess: false,
      cursorOriginChangesAllowed: false,
      cursorPathChangesAllowed: false,
      credentialReferencesPersisted: false,
      authorizationHeadersPersisted: false,
      headerInjectionDeferred: true,
      networkAccess: false,
      externalSideEffects: false,
    },
  };

  const identity = JSON.stringify(withoutId);
  return deepFreezePlan({
    ...withoutId,
    id: `posthog_get_${stableHash(identity)}`,
  });
}
