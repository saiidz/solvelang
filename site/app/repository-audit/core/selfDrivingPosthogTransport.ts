import { POSTHOG_READONLY_CONNECTOR_POLICY } from "./selfDrivingProviderConnector";
import {
  POSTHOG_CLOUD_ORIGINS,
  planPostHogReadRequest,
  postHogRequestPlanUrl,
  type PostHogRequestPlan,
} from "./selfDrivingPosthogRequestPlanner";

export type PostHogEphemeralAuth = {
  authorization: string;
};

export type PostHogTransportRequest = {
  method: "GET";
  url: string;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
};

export type PostHogTransportResponse = {
  status: number;
  contentType: string;
  finalUrl: string;
  body: string;
  redirected?: boolean;
};

export type PostHogTransport = (request: PostHogTransportRequest) => Promise<PostHogTransportResponse>;
export type PostHogAuthProvider = (
  context: Readonly<{ signal: AbortSignal }>,
) => Promise<PostHogEphemeralAuth>;

export type PostHogTransportFailureCategory =
  | "authorization"
  | "cancelled"
  | "timeout"
  | "transport";

export class PostHogTransportFailure extends Error {
  readonly category: PostHogTransportFailureCategory;

  constructor(category: PostHogTransportFailureCategory, message: string) {
    super(message);
    this.name = "PostHogTransportFailure";
    this.category = category;
  }
}

export type PostHogTransportResult = {
  schema: "solvelang.self-driving.posthog-transport.v0";
  mode: "analyze-only";
  source: {
    requestId: string;
    origin: string;
    pathname: string;
    status: number;
    contentType: "application/json";
  };
  policy: {
    injectedTransportOnly: true;
    getOnly: true;
    redirectsAllowed: false;
    credentialMaterialReturned: false;
    rawHeadersReturned: false;
    rawErrorBodyReturned: false;
    repositoryWriteAccess: false;
    productionMutationAccess: false;
    externalSideEffectsOwnedByCore: false;
  };
  execution: {
    bodyBytes: number;
  };
  json: unknown;
};

export type PostHogTransportOptions = {
  maxBodyBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

const defaultMaxBodyBytes = 1_000_000;
const maxAuthorizationLength = 4_096;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("PostHog request plan contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => {
        if (record[key] === undefined) throw new Error("PostHog request plan contains undefined data.");
        return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
      })
      .join(",")}}`;
  }
  throw new Error("PostHog request plan contains unsupported data.");
}

function deriveCanonicalPlan(plan: PostHogRequestPlan): PostHogRequestPlan {
  if (!plan || typeof plan !== "object") throw new Error("PostHog transport requires a valid request plan.");
  const request = (plan as PostHogRequestPlan).request;
  if (!request || typeof request !== "object" || typeof request.pathname !== "string") {
    throw new Error("PostHog transport requires a valid request plan.");
  }

  const matches: Array<{ operation: string; project: string }> = [];
  for (const operation of POSTHOG_READONLY_CONNECTOR_POLICY.allowedOperations) {
    const marker = "{project}";
    const markerIndex = operation.pathTemplate.indexOf(marker);
    if (markerIndex < 0 || operation.pathTemplate.indexOf(marker, markerIndex + marker.length) >= 0) continue;
    const prefix = operation.pathTemplate.slice(0, markerIndex);
    const suffix = operation.pathTemplate.slice(markerIndex + marker.length);
    if (!request.pathname.startsWith(prefix) || !request.pathname.endsWith(suffix)) continue;
    const encodedProject = request.pathname.slice(prefix.length, request.pathname.length - suffix.length);
    if (!encodedProject) continue;
    try {
      const project = decodeURIComponent(encodedProject);
      if (encodeURIComponent(project) !== encodedProject) continue;
      matches.push({ operation: operation.operation, project });
    } catch {
      continue;
    }
  }
  if (matches.length !== 1) throw new Error("PostHog request path is not an exact allowlisted operation path.");

  const query = request.query;
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw new Error("PostHog request plan requires bounded connector pagination.");
  }
  const queryKeys = Object.keys(query).sort();
  if (
    (queryKeys.length !== 1 && queryKeys.length !== 2)
    || queryKeys[0] !== (queryKeys.length === 2 ? "cursor" : "limit")
    || queryKeys[queryKeys.length - 1] !== "limit"
  ) {
    throw new Error("PostHog request plan contains unsupported query authority.");
  }
  if (typeof query.limit !== "string" || !/^[1-9][0-9]*$/.test(query.limit)) {
    throw new Error("PostHog request plan limit is invalid.");
  }
  const pageSize = Number(query.limit);
  if (
    !Number.isSafeInteger(pageSize)
    || pageSize > POSTHOG_READONLY_CONNECTOR_POLICY.maxPageSize
  ) {
    throw new Error("PostHog request plan limit exceeds the connector bound.");
  }
  if (query.cursor !== undefined && typeof query.cursor !== "string") {
    throw new Error("PostHog request plan cursor is invalid.");
  }
  if (typeof request.origin !== "string") throw new Error("PostHog request plan origin is invalid.");

  const allowSelfHostedOrigin = !(POSTHOG_CLOUD_ORIGINS as readonly string[]).includes(request.origin);
  const match = matches[0];
  return planPostHogReadRequest({
    origin: request.origin,
    operation: match.operation,
    project: match.project,
    pageSize,
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    allowSelfHostedOrigin,
  });
}

function assertPlan(plan: PostHogRequestPlan): void {
  let canonical: PostHogRequestPlan;
  try {
    canonical = deriveCanonicalPlan(plan);
  } catch {
    throw new Error("PostHog transport requires an intact canonical request plan.");
  }
  if (canonicalJson(plan) !== canonicalJson(canonical)) {
    throw new Error("PostHog transport requires an intact canonical request plan.");
  }
}

function validateAuth(auth: PostHogEphemeralAuth): string {
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
    throw new Error("Ephemeral PostHog authorization is required.");
  }
  if (Object.keys(auth).sort().join(",") !== "authorization" || typeof auth.authorization !== "string") {
    throw new Error("Ephemeral PostHog authorization is required.");
  }
  const value = auth.authorization;
  if (
    value.length > maxAuthorizationLength
    || !/^Bearer [A-Za-z0-9._~+\/-]{8,}$/.test(value)
  ) {
    throw new Error("Ephemeral PostHog authorization must use a bounded Bearer value.");
  }
  return value;
}

function normalizeContentType(value: string): string {
  if (typeof value !== "string") throw new Error("PostHog response content type is required.");
  return value.split(";", 1)[0].trim().toLowerCase();
}

function bodyByteLength(body: string): number {
  if (typeof body !== "string") throw new Error("PostHog response body must be text for bounded JSON parsing.");
  return new TextEncoder().encode(body).byteLength;
}

function failure(
  category: PostHogTransportFailureCategory,
  message: string,
): PostHogTransportFailure {
  return new PostHogTransportFailure(category, message);
}

export async function executePostHogReadPlan(
  plan: PostHogRequestPlan,
  authProvider: PostHogAuthProvider,
  transport: PostHogTransport,
  options: PostHogTransportOptions = {},
): Promise<PostHogTransportResult> {
  assertPlan(plan);
  if (typeof authProvider !== "function" || typeof transport !== "function") {
    throw new Error("PostHog transport requires injected authorization and transport callbacks.");
  }

  const maxBodyBytes = options.maxBodyBytes ?? defaultMaxBodyBytes;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 5_000_000) {
    throw new Error("maxBodyBytes must be a positive safe integer no greater than 5000000.");
  }
  const timeoutMs = options.timeoutMs ?? POSTHOG_READONLY_CONNECTOR_POLICY.maxWallClockMs;
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > POSTHOG_READONLY_CONNECTOR_POLICY.maxWallClockMs
  ) {
    throw new Error(
      `timeoutMs must be a positive safe integer no greater than ${POSTHOG_READONLY_CONNECTOR_POLICY.maxWallClockMs}.`,
    );
  }
  if (options.signal?.aborted) {
    throw failure("cancelled", "PostHog read was cancelled.");
  }

  const expectedUrl = postHogRequestPlanUrl(plan);
  const controller = new AbortController();
  const externalSignal = options.signal;
  let stopCategory: "cancelled" | "timeout" | undefined;
  let rejectStop: ((reason: PostHogTransportFailure) => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const stop = (category: "cancelled" | "timeout") => {
    if (stopCategory !== undefined) return;
    stopCategory = category;
    rejectStop?.(
      category === "cancelled"
        ? failure("cancelled", "PostHog read was cancelled.")
        : failure("timeout", "PostHog read exceeded its bounded timeout."),
    );
    controller.abort();
  };
  const onExternalAbort = () => stop("cancelled");

  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => stop("timeout"), timeoutMs);

  try {
    let authorization: string;
    try {
      const auth = await Promise.race([
        authProvider(Object.freeze({ signal: controller.signal })),
        stopped,
      ]);
      authorization = validateAuth(auth);
    } catch (error) {
      if (error instanceof PostHogTransportFailure) throw error;
      throw failure(
        "authorization",
        "PostHog ephemeral authorization failed without exposing credential details.",
      );
    }

    let response: PostHogTransportResponse;
    try {
      response = await Promise.race([
        transport({
          method: "GET",
          url: expectedUrl,
          headers: Object.freeze({
            Accept: "application/json",
            Authorization: authorization,
          }),
          signal: controller.signal,
        }),
        stopped,
      ]);
    } catch (error) {
      if (error instanceof PostHogTransportFailure) throw error;
      throw failure(
        "transport",
        "PostHog read transport failed without exposing provider response details.",
      );
    }

    if (!response || typeof response !== "object") throw new Error("PostHog transport returned an invalid response envelope.");
    if (response.redirected === true) throw new Error("PostHog redirects are not allowed.");
    if (response.finalUrl !== expectedUrl) throw new Error("PostHog final URL does not match the approved request plan.");
    if (!Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new Error("PostHog response status is invalid.");
    }
    if (response.status < 200 || response.status > 299) {
      throw new Error(`PostHog read returned HTTP ${response.status}; provider body is suppressed.`);
    }
    const contentType = normalizeContentType(response.contentType);
    if (contentType !== "application/json") throw new Error("PostHog read must return application/json.");

    const bodyBytes = bodyByteLength(response.body);
    if (bodyBytes > maxBodyBytes) throw new Error(`PostHog JSON response exceeds the ${maxBodyBytes}-byte bound.`);

    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      throw new Error("PostHog response is not valid JSON.");
    }

    return {
      schema: "solvelang.self-driving.posthog-transport.v0",
      mode: "analyze-only",
      source: {
        requestId: plan.request.id,
        origin: plan.request.origin,
        pathname: plan.request.pathname,
        status: response.status,
        contentType: "application/json",
      },
      policy: {
        injectedTransportOnly: true,
        getOnly: true,
        redirectsAllowed: false,
        credentialMaterialReturned: false,
        rawHeadersReturned: false,
        rawErrorBodyReturned: false,
        repositoryWriteAccess: false,
        productionMutationAccess: false,
        externalSideEffectsOwnedByCore: false,
      },
      execution: { bodyBytes },
      json,
    };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}
