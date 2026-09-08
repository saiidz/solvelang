import {
  SELF_DRIVING_GITHUB_ACCEPT,
  SELF_DRIVING_GITHUB_API_ORIGIN,
  SELF_DRIVING_GITHUB_API_VERSION,
  SELF_DRIVING_GITHUB_REST_REQUEST_SCHEMA,
  defaultSelfDrivingGitHubRestPlannerLimits,
  type SelfDrivingGitHubRestOperation,
  type SelfDrivingGitHubRestPermission,
  type SelfDrivingGitHubRestRequestPlan,
} from "./selfDrivingGithubRestPlanner";

export const SELF_DRIVING_GITHUB_REST_RESPONSE_SCHEMA =
  "solvelang.self-driving.github-rest-response.v0" as const;

export type SelfDrivingGitHubRestTransportRequest = Readonly<{
  method: "GET" | "POST" | "PATCH";
  url: string;
  headers: Readonly<{
    Accept: typeof SELF_DRIVING_GITHUB_ACCEPT;
    "X-GitHub-Api-Version": typeof SELF_DRIVING_GITHUB_API_VERSION;
    Authorization: string;
    "Content-Type"?: "application/json";
  }>;
  bodyText?: string;
  redirect: "error";
}>;

export type SelfDrivingGitHubRestTransportResponse = Readonly<{
  status: number;
  url: string;
  bodyText: string;
  contentType?: string;
}>;

export type SelfDrivingGitHubRestTransport = (
  request: SelfDrivingGitHubRestTransportRequest,
) => Promise<SelfDrivingGitHubRestTransportResponse>;

export type SelfDrivingGitHubAuthorizationBroker = <T>(
  permission: SelfDrivingGitHubRestPermission,
  useToken: (token: string) => Promise<T>,
) => Promise<T>;

export type SelfDrivingGitHubRestSuccess = Readonly<{
  schema: typeof SELF_DRIVING_GITHUB_REST_RESPONSE_SCHEMA;
  status: "success";
  operation: SelfDrivingGitHubRestOperation;
  httpStatus: number;
  url: string;
  responseBytes: number;
  body: unknown;
  policy: Readonly<{
    authorizationMaterialReturned: false;
    credentialMaterialReturned: false;
    redirectsFollowed: false;
    transportCalls: 1;
    retries: 0;
  }>;
}>;

export type SelfDrivingGitHubRestFailureCode =
  | "invalid-request-plan"
  | "credential-broker-failed"
  | "invalid-credential"
  | "transport-failed"
  | "transport-reentered"
  | "response-url-mismatch"
  | "response-status-unexpected"
  | "response-too-large"
  | "response-content-type-invalid"
  | "response-json-invalid";

export type SelfDrivingGitHubRestFailure = Readonly<{
  schema: typeof SELF_DRIVING_GITHUB_REST_RESPONSE_SCHEMA;
  status: "failed";
  operation: SelfDrivingGitHubRestOperation | "unknown";
  failureCode: SelfDrivingGitHubRestFailureCode;
  transportCalls: 0 | 1;
  policy: Readonly<{
    rawErrorReturned: false;
    authorizationMaterialReturned: false;
    credentialMaterialReturned: false;
    redirectsFollowed: false;
    retries: 0;
  }>;
}>;

export type SelfDrivingGitHubRestExecutionResult =
  | SelfDrivingGitHubRestSuccess
  | SelfDrivingGitHubRestFailure;

type OperationContract = Readonly<{
  method: SelfDrivingGitHubRestRequestPlan["method"];
  permission: SelfDrivingGitHubRestPermission;
  statuses: readonly number[];
  maxResponseBytes: number;
  path: RegExp;
}>;

const ownerRepo = "[A-Za-z0-9_.~-]{1,300}";
const branch = "[A-Za-z0-9._~%/-]{1,512}";
const sha = "[0-9a-f]{40}";

const operationContracts: Readonly<Record<SelfDrivingGitHubRestOperation, OperationContract>> = Object.freeze({
  "get-base-branch": {
    method: "GET",
    permission: "contents:read",
    statuses: [200],
    maxResponseBytes: defaultSelfDrivingGitHubRestPlannerLimits.maxBranchResponseBytes,
    path: new RegExp(`^/repos/${ownerRepo}/${ownerRepo}/branches/${branch}$`),
  },
  "get-base-rules": {
    method: "GET",
    permission: "metadata:read",
    statuses: [200],
    maxResponseBytes: defaultSelfDrivingGitHubRestPlannerLimits.maxRulesResponseBytes,
    path: new RegExp(`^/repos/${ownerRepo}/${ownerRepo}/rules/branches/${branch}$`),
  },
  "get-head-ref": {
    method: "GET",
    permission: "contents:read",
    statuses: [200, 404],
    maxResponseBytes: defaultSelfDrivingGitHubRestPlannerLimits.maxRefResponseBytes,
    path: new RegExp(`^/repos/${ownerRepo}/${ownerRepo}/git/ref/heads/${branch}$`),
  },
  "get-base-commit": {
    method: "GET",
    permission: "contents:read",
    statuses: [200],
    maxResponseBytes: defaultSelfDrivingGitHubRestPlannerLimits.maxCommitResponseBytes,
    path: new RegExp(`^/repos/${ownerRepo}/${ownerRepo}/git/commits/${sha}$`),
  },
  "get-base-tree-recursive": {
    method: "GET",
    permission: "contents:read",
    statuses: [200],
    maxResponseBytes: defaultSelfDrivingGitHubRestPlannerLimits.maxTreeResponseBytes,
    path: new RegExp(`^/repos/${ownerRepo}/${ownerRepo}/git/trees/${sha}\\?recursive=1$`),
  },
  "get-base-blob": {
    method: "GET",
    permission: "contents:read",
    statuses: [200],
    maxResponseBytes: defaultSelfDrivingGitHubRestPlannerLimits.maxBlobResponseBytes,
    path: new RegExp(`^/repos/${ownerRepo}/${ownerRepo}/git/blobs/${sha}$`),
  },
  "create-head-ref": {
    method: "POST",
    permission: "contents:write",
    statuses: [201],
    maxResponseBytes: defaultSelfDrivingGitHubRestPlannerLimits.maxWriteResponseBytes,
    path: new RegExp(`^/repos/${ownerRepo}/${ownerRepo}/git/refs$`),
  },
  "create-tree": {
    method: "POST",
    permission: "contents:write",
    statuses: [201],
    maxResponseBytes: defaultSelfDrivingGitHubRestPlannerLimits.maxWriteResponseBytes,
    path: new RegExp(`^/repos/${ownerRepo}/${ownerRepo}/git/trees$`),
  },
  "create-commit": {
    method: "POST",
    permission: "contents:write",
    statuses: [201],
    maxResponseBytes: defaultSelfDrivingGitHubRestPlannerLimits.maxWriteResponseBytes,
    path: new RegExp(`^/repos/${ownerRepo}/${ownerRepo}/git/commits$`),
  },
  "update-head-ref": {
    method: "PATCH",
    permission: "contents:write",
    statuses: [200],
    maxResponseBytes: defaultSelfDrivingGitHubRestPlannerLimits.maxWriteResponseBytes,
    path: new RegExp(`^/repos/${ownerRepo}/${ownerRepo}/git/refs/heads/${branch}$`),
  },
  "open-pull-request": {
    method: "POST",
    permission: "pull-requests:write",
    statuses: [201],
    maxResponseBytes: defaultSelfDrivingGitHubRestPlannerLimits.maxPullRequestResponseBytes,
    path: new RegExp(`^/repos/${ownerRepo}/${ownerRepo}/pulls$`),
  },
});

const credentialPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9]{12,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
] as const;

function failure(
  code: SelfDrivingGitHubRestFailureCode,
  operation: SelfDrivingGitHubRestOperation | "unknown",
  transportCalls: 0 | 1,
): SelfDrivingGitHubRestFailure {
  return Object.freeze({
    schema: SELF_DRIVING_GITHUB_REST_RESPONSE_SCHEMA,
    status: "failed" as const,
    operation,
    failureCode: code,
    transportCalls,
    policy: Object.freeze({
      rawErrorReturned: false as const,
      authorizationMaterialReturned: false as const,
      credentialMaterialReturned: false as const,
      redirectsFollowed: false as const,
      retries: 0 as const,
    }),
  });
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasCredentialLikeMaterial(value: unknown): boolean {
  let serialized = "";
  try {
    serialized = JSON.stringify(value) ?? "";
  } catch {
    return true;
  }
  return credentialPatterns.some((pattern) => pattern.test(serialized));
}

function validatePlan(value: SelfDrivingGitHubRestRequestPlan): OperationContract {
  if (!value || value.schema !== SELF_DRIVING_GITHUB_REST_REQUEST_SCHEMA) {
    throw new Error("request schema mismatch");
  }
  const contract = operationContracts[value.operation];
  if (!contract) throw new Error("operation is not allowlisted");
  if (value.origin !== SELF_DRIVING_GITHUB_API_ORIGIN) throw new Error("origin mismatch");
  if (value.url !== `${SELF_DRIVING_GITHUB_API_ORIGIN}${value.path}`) throw new Error("url mismatch");
  if (value.method !== contract.method) throw new Error("method mismatch");
  if (!contract.path.test(value.path)) throw new Error("path is not allowlisted for operation");
  if (value.requiredPermission !== contract.permission) throw new Error("permission mismatch");
  if (!sameNumbers(value.expectedStatuses, contract.statuses)) throw new Error("expected status contract mismatch");
  if (value.maxResponseBytes !== contract.maxResponseBytes) throw new Error("response bound mismatch");
  const headerKeys = Object.keys(value.headers).sort();
  if (headerKeys.length !== 2 || headerKeys[0] !== "Accept" || headerKeys[1] !== "X-GitHub-Api-Version") {
    throw new Error("request plan contains unsupported headers");
  }
  if (value.headers.Accept !== SELF_DRIVING_GITHUB_ACCEPT) throw new Error("accept header mismatch");
  if (value.headers["X-GitHub-Api-Version"] !== SELF_DRIVING_GITHUB_API_VERSION) {
    throw new Error("api version mismatch");
  }
  if (
    value.policy.authorizationHeaderIncluded !== false
    || value.policy.credentialMaterialIncluded !== false
    || value.policy.redirectsAllowed !== false
    || value.policy.retries !== 0
    || value.policy.automaticMergeAllowed !== false
    || value.policy.forcePushAllowed !== false
    || value.policy.directProtectedBaseWriteAllowed !== false
  ) {
    throw new Error("request policy weakened");
  }
  if (hasCredentialLikeMaterial(value.body ?? null)) throw new Error("request body contains credential-like material");
  return contract;
}

function validateToken(token: string): string {
  if (typeof token !== "string" || token.length < 16 || token.length > 4096) {
    throw new Error("invalid credential");
  }
  if (/\s|[\u0000-\u001f\u007f]/.test(token)) throw new Error("invalid credential");
  return token;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validJsonContentType(value: string | undefined): boolean {
  if (value === undefined || value === "") return true;
  return /^application\/(?:[A-Za-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(value.trim());
}

export async function executeSelfDrivingGitHubRestRequest(
  plan: SelfDrivingGitHubRestRequestPlan,
  authorizationBroker: SelfDrivingGitHubAuthorizationBroker,
  transport: SelfDrivingGitHubRestTransport,
): Promise<SelfDrivingGitHubRestExecutionResult> {
  let contract: OperationContract;
  let operation: SelfDrivingGitHubRestOperation | "unknown" = "unknown";
  try {
    operation = plan?.operation ?? "unknown";
    contract = validatePlan(plan);
  } catch {
    return failure("invalid-request-plan", operation, 0);
  }

  let transportCalls: 0 | 1 = 0;
  let callbackEntered = false;
  try {
    return await authorizationBroker(contract.permission, async (rawToken) => {
      if (callbackEntered) return failure("transport-reentered", operation, transportCalls);
      callbackEntered = true;

      let token: string;
      try {
        token = validateToken(rawToken);
      } catch {
        return failure("invalid-credential", operation, transportCalls);
      }

      const bodyText = plan.body === undefined ? undefined : JSON.stringify(plan.body);
      const request: SelfDrivingGitHubRestTransportRequest = Object.freeze({
        method: plan.method,
        url: plan.url,
        headers: Object.freeze({
          Accept: SELF_DRIVING_GITHUB_ACCEPT,
          "X-GitHub-Api-Version": SELF_DRIVING_GITHUB_API_VERSION,
          Authorization: `Bearer ${token}`,
          ...(bodyText === undefined ? {} : { "Content-Type": "application/json" as const }),
        }),
        ...(bodyText === undefined ? {} : { bodyText }),
        redirect: "error" as const,
      });

      let response: SelfDrivingGitHubRestTransportResponse;
      try {
        transportCalls = 1;
        response = await transport(request);
      } catch {
        return failure("transport-failed", operation, transportCalls);
      }

      if (!response || response.url !== plan.url) {
        return failure("response-url-mismatch", operation, transportCalls);
      }
      if (!contract.statuses.includes(response.status)) {
        return failure("response-status-unexpected", operation, transportCalls);
      }
      if (typeof response.bodyText !== "string" || byteLength(response.bodyText) > contract.maxResponseBytes) {
        return failure("response-too-large", operation, transportCalls);
      }
      if (!validJsonContentType(response.contentType)) {
        return failure("response-content-type-invalid", operation, transportCalls);
      }

      let body: unknown;
      try {
        body = JSON.parse(response.bodyText);
      } catch {
        return failure("response-json-invalid", operation, transportCalls);
      }

      return Object.freeze({
        schema: SELF_DRIVING_GITHUB_REST_RESPONSE_SCHEMA,
        status: "success" as const,
        operation,
        httpStatus: response.status,
        url: response.url,
        responseBytes: byteLength(response.bodyText),
        body,
        policy: Object.freeze({
          authorizationMaterialReturned: false as const,
          credentialMaterialReturned: false as const,
          redirectsFollowed: false as const,
          transportCalls: 1 as const,
          retries: 0 as const,
        }),
      });
    });
  } catch {
    return failure("credential-broker-failed", operation, transportCalls);
  }
}
