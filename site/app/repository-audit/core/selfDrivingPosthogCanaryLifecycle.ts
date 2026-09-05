import {
  POSTHOG_CANARY_CLAIM_SCHEMA,
  type NormalizedPostHogCanaryApproval,
  type PostHogCanaryClaimResult,
  type PostHogCanaryOperation,
} from "./selfDrivingPosthogCanaryApproval";

export const POSTHOG_CANARY_LIFECYCLE_SCHEMA = "solvelang.self-driving.posthog-canary-lifecycle.v0" as const;
export const POSTHOG_CANARY_FINALIZATION_SCHEMA = "solvelang.self-driving.posthog-canary-finalization.v0" as const;

export const POSTHOG_CANARY_FAILURE_CATEGORIES = [
  "auth-rejected",
  "credential-resolution-failed",
  "malformed-response",
  "oversized-response",
  "provider-error",
  "rate-limited",
  "record-limit-exceeded",
  "sanitization-rejected",
  "timeout",
  "transport-failed",
] as const;
export type PostHogCanaryFailureCategory = (typeof POSTHOG_CANARY_FAILURE_CATEGORIES)[number];

export const POSTHOG_CANARY_PARTIAL_REASONS = [
  "collection-truncated",
  "provider-redacted",
  "sanitizer-partial",
  "source-partial",
] as const;
export type PostHogCanaryPartialReason = (typeof POSTHOG_CANARY_PARTIAL_REASONS)[number];

export const POSTHOG_CANARY_DISABLE_ACTIONS = [
  "abort-active-work",
  "disallow-approval-id",
  "remove-runtime-credential-reference",
  "owner-revoke-canary-key",
  "verify-preauth-denial",
  "delete-sanitized-evidence",
] as const;
export type PostHogCanaryDisableAction = (typeof POSTHOG_CANARY_DISABLE_ACTIONS)[number];

export type PostHogCanaryLifecycleInput = {
  sourceRevision: string;
  outcome: "succeeded" | "failed" | "cancelled";
  failureCategory?: PostHogCanaryFailureCategory;
  startedAt: string;
  endedAt: string;
  responseBytes: number;
  acceptedRecords: number;
  partialReasons: PostHogCanaryPartialReason[];
  sanitizedArtifactSha256?: string | null;
  evidenceDestinationRef: string;
  authorizedReaderRefs: string[];
  deletionOwnerRef: string;
  deleteBy: string;
};

export type PostHogCanaryLifecycleRecord = {
  schema: typeof POSTHOG_CANARY_LIFECYCLE_SCHEMA;
  mode: "sanitized-evidence-only";
  id: string;
  approvalId: string;
  claimId: string;
  requestId: string;
  sourceRevision: string;
  adapterRevision: string;
  project: string;
  origin: string;
  operation: PostHogCanaryOperation;
  outcome: PostHogCanaryLifecycleInput["outcome"];
  failureCategory?: PostHogCanaryFailureCategory;
  attemptCount: 1;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  responseBytes: number;
  acceptedRecords: number;
  partialReasons: PostHogCanaryPartialReason[];
  sanitizedArtifactSha256: string | null;
  retention: {
    evidenceDestinationRef: string;
    authorizedReaderRefs: string[];
    deletionOwnerRef: string;
    deleteBy: string;
    retentionHoursCeiling: number;
  };
  disable: {
    status: "required-actions-not-executed";
    actions: PostHogCanaryDisableAction[];
    deleteSanitizedEvidenceBy: string;
  };
  policy: {
    rawProviderPayloadRetained: false;
    rawProviderDigestAllowed: false;
    sanitizedArtifactOnly: true;
    maxAttempts: 1;
    retries: 0;
    automaticRearm: false;
    maxResponseBytes: 262144;
    maxAcceptedRecords: 25;
    totalDeadlineMs: 10000;
    credentialResolutionAccess: false;
    providerNetworkAccess: false;
    durableSinkAccess: false;
    keyRevocationApiAccess: false;
    repositoryWriteAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    billingMutationAccess: false;
    solveRunnerAuthority: false;
    externalSideEffects: false;
  };
};

export type PostHogCanaryFinalizationRequest = Readonly<{
  schema: typeof POSTHOG_CANARY_FINALIZATION_SCHEMA;
  approvalId: string;
  claimId: string;
  requestId: string;
  lifecycleId: string;
  terminalState: "consumed" | "invalidated";
}>;

export const POSTHOG_CANARY_FINALIZER_REJECTION_REASONS = [
  "already-finalized",
  "binding-mismatch",
  "state-mismatch",
  "store-rejected",
] as const;
export type PostHogCanaryFinalizerRejectionReason = (typeof POSTHOG_CANARY_FINALIZER_REJECTION_REASONS)[number];

export type PostHogCanaryFinalizerDependencyResult =
  | { status: "finalized"; finalizationId: string }
  | { status: "rejected"; reason: PostHogCanaryFinalizerRejectionReason };

export type PostHogCanaryFinalizer = (
  request: PostHogCanaryFinalizationRequest,
) => Promise<PostHogCanaryFinalizerDependencyResult>;

export type PostHogCanaryFinalizationResult = {
  schema: typeof POSTHOG_CANARY_FINALIZATION_SCHEMA;
  status: "finalized" | "rejected";
  approvalId: string;
  claimId: string;
  lifecycleId: string;
  terminalState: "consumed" | "invalidated";
  finalizationId?: string;
  rejectionReason?: PostHogCanaryFinalizerRejectionReason | "finalizer-failure" | "invalid-finalizer-result";
  policy: {
    finalizerCalls: 1;
    retries: 0;
    automaticRearm: false;
    credentialResolutionAccess: false;
    providerNetworkAccess: false;
    durableSinkAccess: false;
    repositoryWriteAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    billingMutationAccess: false;
    solveRunnerAuthority: false;
    credentialMaterialReturned: false;
  };
};

export const defaultPostHogCanaryLifecycleLimits = Object.freeze({
  maxResponseBytes: 262_144,
  maxAcceptedRecords: 25,
  totalDeadlineMs: 10_000,
  maxOpaqueRefLength: 256,
  maxAuthorizedReaders: 16,
  maxSourceRevisionLength: 64,
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

function normalizeOpaqueRef(value: string, name: string): string {
  const normalized = normalizeText(value, name, defaultPostHogCanaryLifecycleLimits.maxOpaqueRefLength);
  if (/^https?:\/\//i.test(normalized)) throw new Error(`${name} must be an opaque reference, not a URL.`);
  if (!/^[A-Za-z][A-Za-z0-9._:/-]{2,255}$/.test(normalized)) {
    throw new Error(`${name} must use bounded opaque-reference syntax.`);
  }
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

function normalizeSha(value: string, name: string): string {
  const normalized = normalizeText(value, name, defaultPostHogCanaryLifecycleLimits.maxSourceRevisionLength).toLowerCase();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(normalized)) {
    throw new Error(`${name} must be an exact 40- or 64-hex revision.`);
  }
  return normalized;
}

function normalizeSanitizedDigest(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeText(value, "sanitizedArtifactSha256", 71).toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("sanitizedArtifactSha256 must be an explicit SHA-256 digest of the sanitized artifact.");
  }
  return normalized;
}

function normalizeFailureCategory(
  value: PostHogCanaryFailureCategory | undefined,
  outcome: PostHogCanaryLifecycleInput["outcome"],
): PostHogCanaryFailureCategory | undefined {
  if (outcome === "succeeded") {
    if (value !== undefined) throw new Error("Successful canary evidence must not include a failure category.");
    return undefined;
  }
  if (outcome === "cancelled") {
    if (value !== undefined) throw new Error("Cancelled canary evidence uses the fixed cancelled outcome, not a failure category.");
    return undefined;
  }
  if (!value || !POSTHOG_CANARY_FAILURE_CATEGORIES.includes(value)) {
    throw new Error("Failed canary evidence requires one supported fixed failure category.");
  }
  return value;
}

function normalizePartialReasons(values: PostHogCanaryPartialReason[]): PostHogCanaryPartialReason[] {
  if (!Array.isArray(values)) throw new Error("partialReasons must be an array.");
  const normalized = values.map((value) => {
    if (!POSTHOG_CANARY_PARTIAL_REASONS.includes(value)) {
      throw new Error(`partialReasons contains an unsupported reason: ${String(value)}`);
    }
    return value;
  }).sort(compareText);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index] === normalized[index - 1]) throw new Error("partialReasons contains duplicate values.");
  }
  return normalized;
}

function normalizeAuthorizedReaders(values: string[]): string[] {
  if (!Array.isArray(values) || values.length === 0) throw new Error("authorizedReaderRefs must be a non-empty array.");
  if (values.length > defaultPostHogCanaryLifecycleLimits.maxAuthorizedReaders) {
    throw new Error(`authorizedReaderRefs exceeds the ${defaultPostHogCanaryLifecycleLimits.maxAuthorizedReaders}-reader safety bound.`);
  }
  const normalized = values.map((value, index) => normalizeOpaqueRef(value, `authorizedReaderRefs[${index}]`)).sort(compareText);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index] === normalized[index - 1]) throw new Error("authorizedReaderRefs contains duplicate values.");
  }
  return normalized;
}

function normalizeBoundedCount(value: number, name: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${name} must be a safe integer between 0 and ${max}.`);
  }
  return value;
}

function assertSafeApproval(approval: NormalizedPostHogCanaryApproval): void {
  if (!approval || typeof approval !== "object") throw new Error("A normalized PostHog canary approval is required.");
  if (approval.schema !== "solvelang.self-driving.posthog-canary-approval.v0" || approval.state !== "approved") {
    throw new Error("Canary lifecycle requires the normalized approved canary contract.");
  }
  if (
    approval.requestPlan.request.method !== "GET"
    || approval.requestPlan.request.origin !== approval.origin
    || approval.requestPlan.request.query.limit !== "25"
    || approval.requestPlan.policy.authorizationMaterialIncluded !== false
    || approval.requestPlan.policy.repositoryWriteAccess !== false
    || approval.requestPlan.policy.productionMutationAccess !== false
    || approval.requestPlan.policy.externalSideEffects !== false
  ) {
    throw new Error("Canary lifecycle requires the safe canonical read request plan boundary.");
  }
  if (!Number.isSafeInteger(approval.retentionHours) || approval.retentionHours < 1 || approval.retentionHours > 24) {
    throw new Error("Canary lifecycle requires an approved retention ceiling between 1 and 24 hours.");
  }
}

function assertSafeClaim(approval: NormalizedPostHogCanaryApproval, claim: PostHogCanaryClaimResult): string {
  if (!claim || typeof claim !== "object") throw new Error("A successful PostHog canary claim is required.");
  if (claim.schema !== POSTHOG_CANARY_CLAIM_SCHEMA || claim.status !== "claimed" || !claim.claimId) {
    throw new Error("Canary lifecycle requires a successful single-use approval claim.");
  }
  if (
    claim.approvalId !== approval.approvalId
    || claim.requestId !== approval.requestPlan.request.id
    || claim.policy.atomicSingleUseClaimRequired !== true
    || claim.policy.approvalClaimMutationAttempted !== true
    || claim.policy.retries !== 0
    || claim.policy.automaticRearm !== false
    || claim.policy.credentialResolutionAccess !== false
    || claim.policy.providerNetworkAccess !== false
    || claim.policy.repositoryWriteAccess !== false
    || claim.policy.productionMutationAccess !== false
    || claim.policy.credentialMaterialReturned !== false
  ) {
    throw new Error("Canary lifecycle claim binding or policy does not match the approved request.");
  }
  return normalizeText(claim.claimId, "claim.claimId", 128);
}

function normalizeFinalizerResult(value: PostHogCanaryFinalizerDependencyResult): PostHogCanaryFinalizerDependencyResult | null {
  if (!value || typeof value !== "object") return null;
  if (value.status === "finalized") {
    try {
      return {
        status: "finalized",
        finalizationId: normalizeText(value.finalizationId, "finalizationId", 128),
      };
    } catch {
      return null;
    }
  }
  if (
    value.status === "rejected"
    && POSTHOG_CANARY_FINALIZER_REJECTION_REASONS.includes(value.reason as PostHogCanaryFinalizerRejectionReason)
  ) {
    return { status: "rejected", reason: value.reason as PostHogCanaryFinalizerRejectionReason };
  }
  return null;
}

export function createPostHogCanaryLifecycleRecord(
  approval: NormalizedPostHogCanaryApproval,
  claim: PostHogCanaryClaimResult,
  input: PostHogCanaryLifecycleInput,
): PostHogCanaryLifecycleRecord {
  assertSafeApproval(approval);
  const claimId = assertSafeClaim(approval, claim);
  if (!input || typeof input !== "object") throw new Error("Canary lifecycle evidence input is required.");

  const sourceRevision = normalizeSha(input.sourceRevision, "sourceRevision");
  const startedAt = normalizeUtcTimestamp(input.startedAt, "startedAt");
  const endedAt = normalizeUtcTimestamp(input.endedAt, "endedAt");
  const claimEpoch = Date.parse(claim.requestedAt);
  const startedEpoch = Date.parse(startedAt);
  const endedEpoch = Date.parse(endedAt);
  if (!Number.isFinite(claimEpoch)) throw new Error("Claim requestedAt must be a valid canonical UTC timestamp.");
  if (startedEpoch < claimEpoch) throw new Error("Canary startedAt must not precede the successful approval claim.");
  if (endedEpoch < startedEpoch) throw new Error("Canary endedAt must not precede startedAt.");
  const durationMs = endedEpoch - claimEpoch;
  if (durationMs > defaultPostHogCanaryLifecycleLimits.totalDeadlineMs) {
    throw new Error(`Canary lifecycle exceeds the ${defaultPostHogCanaryLifecycleLimits.totalDeadlineMs}ms total deadline.`);
  }

  const responseBytes = normalizeBoundedCount(
    input.responseBytes,
    "responseBytes",
    defaultPostHogCanaryLifecycleLimits.maxResponseBytes,
  );
  const acceptedRecords = normalizeBoundedCount(
    input.acceptedRecords,
    "acceptedRecords",
    defaultPostHogCanaryLifecycleLimits.maxAcceptedRecords,
  );
  const partialReasons = normalizePartialReasons(input.partialReasons);
  const failureCategory = normalizeFailureCategory(input.failureCategory, input.outcome);
  const sanitizedArtifactSha256 = normalizeSanitizedDigest(input.sanitizedArtifactSha256);
  if (input.outcome === "succeeded" && !sanitizedArtifactSha256) {
    throw new Error("Successful canary evidence requires a digest of the sanitized artifact.");
  }
  if (input.outcome === "cancelled" && responseBytes !== 0 && !sanitizedArtifactSha256) {
    throw new Error("Cancelled evidence with retained response metadata requires an explicit sanitized artifact digest.");
  }

  const evidenceDestinationRef = normalizeOpaqueRef(input.evidenceDestinationRef, "evidenceDestinationRef");
  const authorizedReaderRefs = normalizeAuthorizedReaders(input.authorizedReaderRefs);
  const deletionOwnerRef = normalizeOpaqueRef(input.deletionOwnerRef, "deletionOwnerRef");
  const deleteBy = normalizeUtcTimestamp(input.deleteBy, "deleteBy");
  const deleteEpoch = Date.parse(deleteBy);
  if (deleteEpoch <= endedEpoch) throw new Error("deleteBy must be after the canary endedAt timestamp.");
  const retentionCeilingEpoch = endedEpoch + approval.retentionHours * 60 * 60 * 1000;
  if (deleteEpoch > retentionCeilingEpoch) {
    throw new Error("deleteBy exceeds the owner-approved sanitized evidence retention ceiling.");
  }

  const canonical = JSON.stringify({
    approvalId: approval.approvalId,
    claimId,
    requestId: claim.requestId,
    sourceRevision,
    adapterRevision: approval.adapterRevision,
    project: approval.project,
    origin: approval.origin,
    operation: approval.operation,
    outcome: input.outcome,
    failureCategory,
    startedAt,
    endedAt,
    responseBytes,
    acceptedRecords,
    partialReasons,
    sanitizedArtifactSha256,
    evidenceDestinationRef,
    authorizedReaderRefs,
    deletionOwnerRef,
    deleteBy,
  });

  return {
    schema: POSTHOG_CANARY_LIFECYCLE_SCHEMA,
    mode: "sanitized-evidence-only",
    id: `canary_lifecycle_${stableHash(canonical)}`,
    approvalId: approval.approvalId,
    claimId,
    requestId: claim.requestId,
    sourceRevision,
    adapterRevision: approval.adapterRevision,
    project: approval.project,
    origin: approval.origin,
    operation: approval.operation,
    outcome: input.outcome,
    ...(failureCategory ? { failureCategory } : {}),
    attemptCount: 1,
    startedAt,
    endedAt,
    durationMs,
    responseBytes,
    acceptedRecords,
    partialReasons,
    sanitizedArtifactSha256,
    retention: {
      evidenceDestinationRef,
      authorizedReaderRefs,
      deletionOwnerRef,
      deleteBy,
      retentionHoursCeiling: approval.retentionHours,
    },
    disable: {
      status: "required-actions-not-executed",
      actions: [...POSTHOG_CANARY_DISABLE_ACTIONS],
      deleteSanitizedEvidenceBy: deleteBy,
    },
    policy: {
      rawProviderPayloadRetained: false,
      rawProviderDigestAllowed: false,
      sanitizedArtifactOnly: true,
      maxAttempts: 1,
      retries: 0,
      automaticRearm: false,
      maxResponseBytes: defaultPostHogCanaryLifecycleLimits.maxResponseBytes,
      maxAcceptedRecords: defaultPostHogCanaryLifecycleLimits.maxAcceptedRecords,
      totalDeadlineMs: defaultPostHogCanaryLifecycleLimits.totalDeadlineMs,
      credentialResolutionAccess: false,
      providerNetworkAccess: false,
      durableSinkAccess: false,
      keyRevocationApiAccess: false,
      repositoryWriteAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      billingMutationAccess: false,
      solveRunnerAuthority: false,
      externalSideEffects: false,
    },
  };
}

export async function finalizePostHogCanaryLifecycle(
  record: PostHogCanaryLifecycleRecord,
  finalizer: PostHogCanaryFinalizer,
): Promise<PostHogCanaryFinalizationResult> {
  if (!record || typeof record !== "object" || record.schema !== POSTHOG_CANARY_LIFECYCLE_SCHEMA) {
    throw new Error("A canonical PostHog canary lifecycle record is required.");
  }
  if (
    record.policy.rawProviderPayloadRetained !== false
    || record.policy.rawProviderDigestAllowed !== false
    || record.policy.sanitizedArtifactOnly !== true
    || record.policy.maxAttempts !== 1
    || record.policy.retries !== 0
    || record.policy.automaticRearm !== false
    || record.policy.credentialResolutionAccess !== false
    || record.policy.providerNetworkAccess !== false
    || record.policy.durableSinkAccess !== false
    || record.policy.keyRevocationApiAccess !== false
    || record.policy.repositoryWriteAccess !== false
    || record.policy.productionMutationAccess !== false
    || record.policy.externalSideEffects !== false
  ) {
    throw new Error("Canary finalization requires the safe canonical lifecycle policy boundary.");
  }
  if (typeof finalizer !== "function") throw new Error("An injected atomic canary lifecycle finalizer is required.");

  const terminalState = record.outcome === "succeeded" ? "consumed" : "invalidated";
  const request: PostHogCanaryFinalizationRequest = Object.freeze({
    schema: POSTHOG_CANARY_FINALIZATION_SCHEMA,
    approvalId: record.approvalId,
    claimId: record.claimId,
    requestId: record.requestId,
    lifecycleId: record.id,
    terminalState,
  });
  const base: Omit<PostHogCanaryFinalizationResult, "status"> = {
    schema: POSTHOG_CANARY_FINALIZATION_SCHEMA,
    approvalId: record.approvalId,
    claimId: record.claimId,
    lifecycleId: record.id,
    terminalState,
    policy: {
      finalizerCalls: 1,
      retries: 0,
      automaticRearm: false,
      credentialResolutionAccess: false,
      providerNetworkAccess: false,
      durableSinkAccess: false,
      repositoryWriteAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      billingMutationAccess: false,
      solveRunnerAuthority: false,
      credentialMaterialReturned: false,
    },
  };

  let dependencyResult: PostHogCanaryFinalizerDependencyResult;
  try {
    dependencyResult = await finalizer(request);
  } catch {
    return { ...base, status: "rejected", rejectionReason: "finalizer-failure" };
  }
  const normalized = normalizeFinalizerResult(dependencyResult);
  if (!normalized) return { ...base, status: "rejected", rejectionReason: "invalid-finalizer-result" };
  if (normalized.status === "rejected") {
    return { ...base, status: "rejected", rejectionReason: normalized.reason };
  }
  return { ...base, status: "finalized", finalizationId: normalized.finalizationId };
}
