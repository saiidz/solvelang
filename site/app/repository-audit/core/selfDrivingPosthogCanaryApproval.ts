import {
  planPostHogReadRequest,
  type PostHogRequestPlan,
} from "./selfDrivingPosthogRequestPlanner";

export const POSTHOG_CANARY_APPROVAL_SCHEMA = "solvelang.self-driving.posthog-canary-approval.v0" as const;
export const POSTHOG_CANARY_CLAIM_SCHEMA = "solvelang.self-driving.posthog-canary-claim.v0" as const;

export const POSTHOG_CANARY_OPERATIONS = ["read-errors", "read-feature-flags"] as const;
export type PostHogCanaryOperation = (typeof POSTHOG_CANARY_OPERATIONS)[number];

export type PostHogCanaryApprovalInput = {
  schema: typeof POSTHOG_CANARY_APPROVAL_SCHEMA;
  state: "approved";
  approvalId: string;
  tenantId: string;
  systemBoundary: string;
  project: string;
  origin: string;
  operation: PostHogCanaryOperation;
  credentialRef: string;
  credentialScope: string;
  operator: string;
  runtime: string;
  adapterRevision: string;
  notBefore: string;
  expiresAt: string;
  retentionHours: number;
};

export type NormalizedPostHogCanaryApproval = Readonly<{
  schema: typeof POSTHOG_CANARY_APPROVAL_SCHEMA;
  state: "approved";
  approvalId: string;
  tenantId: string;
  systemBoundary: string;
  project: string;
  origin: string;
  operation: PostHogCanaryOperation;
  credentialRef: string;
  credentialScope: string;
  operator: string;
  runtime: string;
  adapterRevision: string;
  notBefore: string;
  expiresAt: string;
  retentionHours: number;
  requestPlan: Readonly<PostHogRequestPlan>;
}>;

export type PostHogCanaryAtomicClaimRequest = Readonly<{
  schema: typeof POSTHOG_CANARY_CLAIM_SCHEMA;
  expectedState: "approved";
  approvalId: string;
  requestedAt: string;
  binding: NormalizedPostHogCanaryApproval;
}>;

export const POSTHOG_CANARY_CLAIM_REJECTION_REASONS = [
  "not-approved",
  "already-claimed",
  "already-consumed",
  "expired",
  "binding-mismatch",
  "store-rejected",
] as const;
export type PostHogCanaryClaimRejectionReason = (typeof POSTHOG_CANARY_CLAIM_REJECTION_REASONS)[number];

export type PostHogCanaryAtomicClaimDependencyResult =
  | { status: "claimed"; claimId: string }
  | { status: "rejected"; reason: PostHogCanaryClaimRejectionReason };

export type PostHogCanaryAtomicClaimer = (
  request: PostHogCanaryAtomicClaimRequest,
) => Promise<PostHogCanaryAtomicClaimDependencyResult>;

export type PostHogCanaryClaimResult = {
  schema: typeof POSTHOG_CANARY_CLAIM_SCHEMA;
  status: "claimed" | "rejected";
  approvalId: string;
  requestedAt: string;
  requestId: string;
  claimId?: string;
  rejectionReason?: PostHogCanaryClaimRejectionReason | "claimer-failure" | "invalid-claim-result";
  policy: {
    atomicSingleUseClaimRequired: true;
    approvalClaimMutationAttempted: true;
    retries: 0;
    automaticRearm: false;
    credentialResolutionAccess: false;
    providerNetworkAccess: false;
    repositoryWriteAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    billingMutationAccess: false;
    solveRunnerAuthority: false;
    credentialMaterialReturned: false;
  };
};

export const defaultPostHogCanaryApprovalLimits = Object.freeze({
  maxApprovalIdLength: 128,
  maxIdentifierLength: 256,
  maxCredentialRefLength: 512,
  maxScopeLength: 256,
  maxRevisionLength: 128,
  maxRetentionHours: 24,
  canaryPageSize: 25,
});

const credentialLikePatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\b(?:sk|pk)-(?:live|test)-[A-Za-z0-9_-]{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9]{12,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
  /\bsl_(?:test|live)_[A-Za-z0-9_-]{8,}\b/i,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
] as const;

function hasCredentialLikeText(value: string): boolean {
  return credentialLikePatterns.some((pattern) => pattern.test(value));
}

function normalizeText(value: string, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character bound.`);
  if (/[\r\n\u0000-\u001f]/.test(normalized)) throw new Error(`${name} must be single-line text.`);
  if (hasCredentialLikeText(normalized)) throw new Error(`${name} contains credential-like material.`);
  return normalized;
}

function normalizeOpaqueCredentialRef(value: string): string {
  const normalized = normalizeText(value, "credentialRef", defaultPostHogCanaryApprovalLimits.maxCredentialRefLength);
  if (!/^[A-Za-z][A-Za-z0-9._:/-]{2,511}$/.test(normalized)) {
    throw new Error("credentialRef must be an opaque bounded reference, not credential material.");
  }
  if (/^https?:\/\//i.test(normalized)) throw new Error("credentialRef must not be a network URL.");
  return normalized;
}

function normalizeUtcTimestamp(value: string, name: string): string {
  const normalized = normalizeText(value, name, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)) {
    throw new Error(`${name} must be an explicit UTC timestamp.`);
  }
  const epoch = Date.parse(normalized);
  if (!Number.isFinite(epoch)) throw new Error(`${name} must be a valid UTC timestamp.`);
  return new Date(epoch).toISOString();
}

function normalizeOperation(value: string): PostHogCanaryOperation {
  if (!POSTHOG_CANARY_OPERATIONS.includes(value as PostHogCanaryOperation)) {
    throw new Error("operation is not approved for the one-request sanitized canary.");
  }
  return value as PostHogCanaryOperation;
}

function deepFreezePlan(plan: PostHogRequestPlan): Readonly<PostHogRequestPlan> {
  Object.freeze(plan.request.query);
  Object.freeze(plan.request);
  Object.freeze(plan.policy);
  return Object.freeze(plan);
}

function normalizeClaimDependencyResult(
  value: PostHogCanaryAtomicClaimDependencyResult,
): PostHogCanaryAtomicClaimDependencyResult | null {
  if (!value || typeof value !== "object") return null;
  if (value.status === "claimed") {
    try {
      return {
        status: "claimed",
        claimId: normalizeText(value.claimId, "claimId", 128),
      };
    } catch {
      return null;
    }
  }
  if (
    value.status === "rejected"
    && POSTHOG_CANARY_CLAIM_REJECTION_REASONS.includes(value.reason as PostHogCanaryClaimRejectionReason)
  ) {
    return { status: "rejected", reason: value.reason as PostHogCanaryClaimRejectionReason };
  }
  return null;
}

export function normalizePostHogCanaryApproval(input: PostHogCanaryApprovalInput): NormalizedPostHogCanaryApproval {
  if (!input || typeof input !== "object") throw new Error("PostHog canary approval is required.");
  if (input.schema !== POSTHOG_CANARY_APPROVAL_SCHEMA) throw new Error("PostHog canary approval schema is not supported.");
  if (input.state !== "approved") throw new Error("PostHog canary approval must be in approved state before claim.");

  const approvalId = normalizeText(input.approvalId, "approvalId", defaultPostHogCanaryApprovalLimits.maxApprovalIdLength);
  const tenantId = normalizeText(input.tenantId, "tenantId", defaultPostHogCanaryApprovalLimits.maxIdentifierLength);
  const systemBoundary = normalizeText(input.systemBoundary, "systemBoundary", defaultPostHogCanaryApprovalLimits.maxIdentifierLength);
  const project = normalizeText(input.project, "project", 20);
  if (!/^[1-9][0-9]{0,19}$/.test(project)) throw new Error("project must be a canonical positive numeric identifier.");
  const operation = normalizeOperation(input.operation);
  const credentialRef = normalizeOpaqueCredentialRef(input.credentialRef);
  const credentialScope = normalizeText(input.credentialScope, "credentialScope", defaultPostHogCanaryApprovalLimits.maxScopeLength);
  const operator = normalizeText(input.operator, "operator", defaultPostHogCanaryApprovalLimits.maxIdentifierLength);
  const runtime = normalizeText(input.runtime, "runtime", defaultPostHogCanaryApprovalLimits.maxIdentifierLength);
  const adapterRevision = normalizeText(input.adapterRevision, "adapterRevision", defaultPostHogCanaryApprovalLimits.maxRevisionLength);
  const notBefore = normalizeUtcTimestamp(input.notBefore, "notBefore");
  const expiresAt = normalizeUtcTimestamp(input.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(notBefore)) throw new Error("expiresAt must be after notBefore.");
  if (!Number.isSafeInteger(input.retentionHours) || input.retentionHours < 1 || input.retentionHours > defaultPostHogCanaryApprovalLimits.maxRetentionHours) {
    throw new Error(`retentionHours must be between 1 and ${defaultPostHogCanaryApprovalLimits.maxRetentionHours}.`);
  }

  const requestPlan = deepFreezePlan(planPostHogReadRequest({
    origin: normalizeText(input.origin, "origin", 256),
    operation,
    project,
    pageSize: defaultPostHogCanaryApprovalLimits.canaryPageSize,
  }));

  const normalized = {
    schema: POSTHOG_CANARY_APPROVAL_SCHEMA,
    state: "approved" as const,
    approvalId,
    tenantId,
    systemBoundary,
    project,
    origin: requestPlan.request.origin,
    operation,
    credentialRef,
    credentialScope,
    operator,
    runtime,
    adapterRevision,
    notBefore,
    expiresAt,
    retentionHours: input.retentionHours,
    requestPlan,
  };
  return Object.freeze(normalized);
}

export async function claimPostHogCanaryApproval(
  input: PostHogCanaryApprovalInput,
  claimer: PostHogCanaryAtomicClaimer,
  options: { now: string },
): Promise<PostHogCanaryClaimResult> {
  const approval = normalizePostHogCanaryApproval(input);
  if (typeof claimer !== "function") throw new Error("An injected atomic canary approval claimer is required.");
  if (!options || typeof options !== "object") throw new Error("Canary claim options are required.");
  const requestedAt = normalizeUtcTimestamp(options.now, "now");
  const nowEpoch = Date.parse(requestedAt);
  if (nowEpoch < Date.parse(approval.notBefore)) throw new Error("Canary approval is not active yet.");
  if (nowEpoch >= Date.parse(approval.expiresAt)) throw new Error("Canary approval is expired.");

  const claimRequest: PostHogCanaryAtomicClaimRequest = Object.freeze({
    schema: POSTHOG_CANARY_CLAIM_SCHEMA,
    expectedState: "approved",
    approvalId: approval.approvalId,
    requestedAt,
    binding: approval,
  });

  const base: Omit<PostHogCanaryClaimResult, "status"> = {
    schema: POSTHOG_CANARY_CLAIM_SCHEMA,
    approvalId: approval.approvalId,
    requestedAt,
    requestId: approval.requestPlan.request.id,
    policy: {
      atomicSingleUseClaimRequired: true,
      approvalClaimMutationAttempted: true,
      retries: 0,
      automaticRearm: false,
      credentialResolutionAccess: false,
      providerNetworkAccess: false,
      repositoryWriteAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      billingMutationAccess: false,
      solveRunnerAuthority: false,
      credentialMaterialReturned: false,
    },
  };

  let dependencyResult: PostHogCanaryAtomicClaimDependencyResult;
  try {
    dependencyResult = await claimer(claimRequest);
  } catch {
    return { ...base, status: "rejected", rejectionReason: "claimer-failure" };
  }

  const result = normalizeClaimDependencyResult(dependencyResult);
  if (!result) return { ...base, status: "rejected", rejectionReason: "invalid-claim-result" };
  if (result.status === "rejected") {
    return { ...base, status: "rejected", rejectionReason: result.reason };
  }
  return { ...base, status: "claimed", claimId: result.claimId };
}
