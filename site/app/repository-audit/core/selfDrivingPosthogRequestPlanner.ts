import {
  POSTHOG_READONLY_CONNECTOR_POLICY,
  type ProviderReadOperationPolicy,
} from "./selfDrivingProviderConnector";

export type PostHogRequestPlannerInput = {
  origin: string;
  operation: string;
  project: string;
  pageSize: number;
  cursor?: string;
  allowSelfHostedOrigin?: boolean;
};

export type PostHogRequestPlan = {
  schema: "solvelang.self-driving.posthog-request-plan.v0";
  mode: "analyze-only";
  request: {
    id: string;
    method: "GET";
    origin: string;
    pathname: string;
    query: {
      limit: string;
      cursor?: string;
    };
  };
  policy: {
    readOnly: true;
    requestBodyAllowed: false;
    authorizationMaterialIncluded: false;
    arbitraryPathAccess: false;
    arbitraryHostAccess: false;
    repositoryWriteAccess: false;
    productionMutationAccess: false;
    externalSideEffects: false;
  };
};

export const POSTHOG_CLOUD_ORIGINS = Object.freeze([
  "https://us.posthog.com",
  "https://eu.posthog.com",
] as const);

const hostnamePattern = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const ipv6LikePattern = /:/;

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

function normalizeText(value: string, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character bound.`);
  if (/[\r\n\u0000-\u001f]/.test(normalized)) throw new Error(`${name} must be single-line text.`);
  return normalized;
}

function normalizeOrigin(raw: string, allowSelfHostedOrigin: boolean): string {
  const text = normalizeText(raw, "origin", 256);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("origin must be a valid HTTPS origin.");
  }
  if (parsed.protocol !== "https:") throw new Error("PostHog origin must use HTTPS.");
  if (parsed.username || parsed.password) throw new Error("PostHog origin must not contain userinfo.");
  if (parsed.hash) throw new Error("PostHog origin must not contain a fragment.");
  if (parsed.search) throw new Error("PostHog origin must not contain a query string.");
  if (parsed.pathname !== "/") throw new Error("PostHog origin must not contain a path.");
  if (parsed.port && parsed.port !== "443") throw new Error("PostHog origin must use the default HTTPS port.");

  const hostname = parsed.hostname.toLowerCase();
  if (ipv4Pattern.test(hostname) || ipv6LikePattern.test(hostname)) {
    throw new Error("PostHog origin must use a DNS hostname, not an IP literal.");
  }
  const normalizedOrigin = `https://${hostname}`;
  if ((POSTHOG_CLOUD_ORIGINS as readonly string[]).includes(normalizedOrigin)) return normalizedOrigin;
  if (!allowSelfHostedOrigin) throw new Error("PostHog origin is not an allowlisted cloud origin.");
  if (!hostnamePattern.test(hostname)) throw new Error("Self-hosted PostHog origin must use a valid DNS hostname.");
  return normalizedOrigin;
}

function operationPolicy(operation: string): ProviderReadOperationPolicy {
  const normalized = normalizeText(operation, "operation", 64);
  const match = POSTHOG_READONLY_CONNECTOR_POLICY.allowedOperations.find((item) => item.operation === normalized);
  if (!match) throw new Error(`PostHog operation '${normalized}' is not allowlisted for read-only requests.`);
  return match;
}

function normalizeProject(value: string): string {
  const normalized = normalizeText(value, "project", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) {
    throw new Error("project must use bounded identifier syntax.");
  }
  return normalized;
}

function normalizeCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeText(value, "cursor", 512);
  if (/^https?:\/\//i.test(normalized)) throw new Error("cursor must not contain an absolute URL.");
  if (/[?#]/.test(normalized)) throw new Error("cursor must be an opaque bounded token without URL/query syntax.");
  if (normalized.includes("..") || normalized.includes("/")) throw new Error("cursor must not contain path syntax.");
  if (!/^[A-Za-z0-9._~+=:-]{1,512}$/.test(normalized)) throw new Error("cursor contains unsupported characters.");
  return normalized;
}

function renderPath(template: string, project: string): string {
  if (!template.startsWith("/api/projects/{project}/")) {
    throw new Error("PostHog operation path template is outside the allowlisted project scope.");
  }
  const encodedProject = encodeURIComponent(project);
  const rendered = template.replace("{project}", encodedProject);
  if (!rendered.startsWith(`/api/projects/${encodedProject}/`)) throw new Error("Rendered PostHog path escaped project scope.");
  if (rendered.includes("..") || rendered.includes("//")) throw new Error("Rendered PostHog path contains traversal or ambiguous separators.");
  return rendered;
}

export function planPostHogReadRequest(input: PostHogRequestPlannerInput): PostHogRequestPlan {
  const origin = normalizeOrigin(input.origin, input.allowSelfHostedOrigin === true);
  const operation = operationPolicy(input.operation);
  const project = normalizeProject(input.project);
  if (operation.operation === "read-errors" || operation.operation === "read-feature-flags") {
    if (!/^[1-9][0-9]{0,19}$/.test(project)) throw new Error("Sanitized PostHog reads require a canonical positive numeric project identifier.");
    if (input.cursor !== undefined) throw new Error("Sanitized PostHog reads support first-page requests only; cursor pagination is not supported.");
  }
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > POSTHOG_READONLY_CONNECTOR_POLICY.maxPageSize) {
    throw new Error(`pageSize must be a positive safe integer no greater than ${POSTHOG_READONLY_CONNECTOR_POLICY.maxPageSize}.`);
  }
  const cursor = normalizeCursor(input.cursor);
  const pathname = renderPath(operation.pathTemplate, project);
  const query = {
    limit: String(input.pageSize),
    ...(cursor ? { cursor } : {}),
  };
  const identity = JSON.stringify({ method: "GET", origin, pathname, query, operation: operation.operation });

  return {
    schema: "solvelang.self-driving.posthog-request-plan.v0",
    mode: "analyze-only",
    request: {
      id: `phr_${stableHash(identity)}`,
      method: "GET",
      origin,
      pathname,
      query,
    },
    policy: {
      readOnly: true,
      requestBodyAllowed: false,
      authorizationMaterialIncluded: false,
      arbitraryPathAccess: false,
      arbitraryHostAccess: false,
      repositoryWriteAccess: false,
      productionMutationAccess: false,
      externalSideEffects: false,
    },
  };
}

export function postHogRequestPlanUrl(plan: PostHogRequestPlan): string {
  const pairs = Object.entries(plan.request.query).sort(([left], [right]) => compareText(left, right));
  const search = new URLSearchParams(pairs).toString();
  return `${plan.request.origin}${plan.request.pathname}${search ? `?${search}` : ""}`;
}
