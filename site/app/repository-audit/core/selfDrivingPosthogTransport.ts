import {
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
};

export type PostHogTransportResponse = {
  status: number;
  contentType: string;
  finalUrl: string;
  body: string;
  redirected?: boolean;
};

export type PostHogTransport = (request: PostHogTransportRequest) => Promise<PostHogTransportResponse>;
export type PostHogAuthProvider = () => Promise<PostHogEphemeralAuth>;

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
};

const defaultMaxBodyBytes = 1_000_000;

function assertPlan(plan: PostHogRequestPlan): void {
  if (!plan || plan.schema !== "solvelang.self-driving.posthog-request-plan.v0") {
    throw new Error("PostHog transport requires a valid request plan.");
  }
  if (plan.mode !== "analyze-only" || plan.request.method !== "GET") {
    throw new Error("PostHog transport accepts analyze-only GET plans only.");
  }
  if (
    plan.policy.readOnly !== true
    || plan.policy.requestBodyAllowed !== false
    || plan.policy.authorizationMaterialIncluded !== false
    || plan.policy.externalSideEffects !== false
  ) {
    throw new Error("PostHog request plan weakens the read-only planning boundary.");
  }
}

function validateAuth(auth: PostHogEphemeralAuth): string {
  if (!auth || typeof auth.authorization !== "string") throw new Error("Ephemeral PostHog authorization is required.");
  const value = auth.authorization.trim();
  if (!/^Bearer [A-Za-z0-9._~+\/-]{8,}$/.test(value)) {
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

export async function executePostHogReadPlan(
  plan: PostHogRequestPlan,
  authProvider: PostHogAuthProvider,
  transport: PostHogTransport,
  options: PostHogTransportOptions = {},
): Promise<PostHogTransportResult> {
  assertPlan(plan);
  const maxBodyBytes = options.maxBodyBytes ?? defaultMaxBodyBytes;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 5_000_000) {
    throw new Error("maxBodyBytes must be a positive safe integer no greater than 5000000.");
  }

  const expectedUrl = postHogRequestPlanUrl(plan);
  const authorization = validateAuth(await authProvider());
  let response: PostHogTransportResponse;
  try {
    response = await transport({
      method: "GET",
      url: expectedUrl,
      headers: Object.freeze({
        Accept: "application/json",
        Authorization: authorization,
      }),
    });
  } catch {
    throw new Error("PostHog read transport failed without exposing provider response details.");
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
}
