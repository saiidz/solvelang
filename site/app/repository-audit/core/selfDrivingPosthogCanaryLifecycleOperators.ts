import {
  POSTHOG_CANARY_DISABLE_ACTIONS,
  POSTHOG_CANARY_FINALIZATION_SCHEMA,
  POSTHOG_CANARY_LIFECYCLE_SCHEMA,
  type PostHogCanaryDisableAction,
  type PostHogCanaryFinalizationResult,
  type PostHogCanaryLifecycleRecord,
} from "./selfDrivingPosthogCanaryLifecycle";
import type { PostHogCanaryRuntimeActivation } from "./selfDrivingPosthogCanaryRuntimeGate";

export const POSTHOG_CANARY_LIFECYCLE_OPERATOR_PLAN_SCHEMA =
  "solvelang.self-driving.posthog-canary-lifecycle-operator-plan.v0" as const;
export const POSTHOG_CANARY_LIFECYCLE_OPERATOR_EVIDENCE_SCHEMA =
  "solvelang.self-driving.posthog-canary-lifecycle-operator-evidence.v0" as const;
export const POSTHOG_CANARY_LIFECYCLE_OPERATOR_RESULT_SCHEMA =
  "solvelang.self-driving.posthog-canary-lifecycle-operator-result.v0" as const;

export const defaultPostHogCanaryLifecycleOperatorLimits = Object.freeze({
  maxEvidenceIdLength: 128,
  maxClockTextLength: 64,
});

export type PostHogCanaryLifecycleOperatorPlan = Readonly<{
  schema: typeof POSTHOG_CANARY_LIFECYCLE_OPERATOR_PLAN_SCHEMA;
  id: string;
  activationId: string;
  approvalId: string;
  claimId: string;
  requestId: string;
  lifecycleId: string;
  finalizationId: string;
  project: string;
  origin: string;
  operation: string;
  credentialRef: string;
  killSwitchRef: string;
  evidenceDestinationRef: string;
  sanitizedArtifactSha256: string | null;
  deleteBy: string;
  plannedAt: string;
  actions: readonly PostHogCanaryDisableAction[];
}>;

export type PostHogCanaryLifecycleActionEvidence = Readonly<{
  action: PostHogCanaryDisableAction;
  evidenceId: string;
}>;

export type PostHogCanaryLifecycleOperatorEvidence = Readonly<{
  schema: typeof POSTHOG_CANARY_LIFECYCLE_OPERATOR_EVIDENCE_SCHEMA;
  planId: string;
  lifecycleId: string;
  completedAt: string;
  retentionEvidenceId: string;
  actionEvidence: readonly PostHogCanaryLifecycleActionEvidence[];
}>;

export type PostHogCanaryLifecycleOperator = (
  plan: PostHogCanaryLifecycleOperatorPlan,
) => Promise<PostHogCanaryLifecycleOperatorEvidence>;

export type PostHogCanaryLifecycleOperatorDependencies = Readonly<{
  operator: PostHogCanaryLifecycleOperator;
  now: () => string;
}>;

export type PostHogCanaryLifecycleOperatorResult = Readonly<{
  schema: typeof POSTHOG_CANARY_LIFECYCLE_OPERATOR_RESULT_SCHEMA;
  status: "qualified";
  planId: string;
  lifecycleId: string;
  evidenceId: string;
  completedAt: string;
  actionEvidence: readonly PostHogCanaryLifecycleActionEvidence[];
  policy: Readonly<{
    operatorCalls: 1;
    retries: 0;
    automaticRearm: false;
    builtInCredentialStoreAccess: false;
    builtInKeyRevocationApiAccess: false;
    builtInEvidenceStoreAccess: false;
    repositoryWriteAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    billingMutationAccess: false;
    solveRunnerAuthority: false;
    rawCredentialMaterialReturned: false;
  }>;
}>;

const textEncoder = new TextEncoder();
const credentialLikePatterns = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/i,
  /\b(?:sk|pk)-(?:live|test)-[A-Za-z0-9_-]{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9_-]{12,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
  /\bsl_(?:test|live)_[A-Za-z0-9_-]{8,}\b/i,
  /\bAKIA[A-Z0-9]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
] as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical lifecycle-operator data contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => {
      if (record[key] === undefined) throw new Error("Canonical lifecycle-operator data contains undefined.");
      return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
    }).join(",")}}`;
  }
  throw new Error("Canonical lifecycle-operator data contains unsupported data.");
}

function normalizeText(value: string, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character bound.`);
  if (/[\r\n\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${name} must be single-line text.`);
  if (credentialLikePatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error(`${name} contains credential-like material.`);
  }
  return normalized;
}

function normalizeUtc(value: string, name: string): string {
  const normalized = normalizeText(value, name, defaultPostHogCanaryLifecycleOperatorLimits.maxClockTextLength);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)) {
    throw new Error(`${name} must be an explicit UTC timestamp.`);
  }
  const epoch = Date.parse(normalized);
  if (!Number.isFinite(epoch)) throw new Error(`${name} must be a valid UTC timestamp.`);
  return new Date(epoch).toISOString();
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 support is required for PostHog lifecycle operator plans.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function expectedActivationPolicy() {
  return {
    exactApprovalRequired: true,
    successfulSingleUseClaimRequired: true,
    boundedActivationWindow: true,
    killSwitchRequiredBeforeCredentialAccess: true,
    killSwitchRequiredBeforeCredentialRelease: true,
    isolatedCredentialLeaseRequired: true,
    credentialProviderSingleUse: true,
    rawCredentialMaterialReturned: false,
    builtInSecretStoreAccess: false,
    builtInNetworkClient: false,
    retries: 0,
    automaticRearm: false,
    repositoryWriteAccess: false,
    rolloutMutationAccess: false,
    productionMutationAccess: false,
    billingMutationAccess: false,
    solveRunnerAuthority: false,
  } as const;
}

function expectedLifecyclePolicy() {
  return {
    rawProviderPayloadRetained: false,
    rawProviderDigestAllowed: false,
    sanitizedArtifactOnly: true,
    maxAttempts: 1,
    retries: 0,
    automaticRearm: false,
    maxResponseBytes: 262144,
    maxAcceptedRecords: 25,
    totalDeadlineMs: 10000,
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
  } as const;
}

function expectedFinalizationPolicy() {
  return {
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
  } as const;
}

function resultPolicy(): PostHogCanaryLifecycleOperatorResult["policy"] {
  return Object.freeze({
    operatorCalls: 1 as const,
    retries: 0 as const,
    automaticRearm: false as const,
    builtInCredentialStoreAccess: false as const,
    builtInKeyRevocationApiAccess: false as const,
    builtInEvidenceStoreAccess: false as const,
    repositoryWriteAccess: false as const,
    rolloutMutationAccess: false as const,
    productionMutationAccess: false as const,
    billingMutationAccess: false as const,
    solveRunnerAuthority: false as const,
    rawCredentialMaterialReturned: false as const,
  });
}

function assertActivationRecordBinding(
  activation: PostHogCanaryRuntimeActivation,
  record: PostHogCanaryLifecycleRecord,
): void {
  if (
    !activation
    || typeof activation !== "object"
    || activation.schema !== "solvelang.self-driving.posthog-canary-runtime-activation.v0"
    || activation.state !== "approved"
    || !/^posthog_canary_runtime_activation_[0-9a-f]{64}$/.test(activation.id)
    || canonicalJson(activation.policy) !== canonicalJson(expectedActivationPolicy())
  ) {
    throw new Error("PostHog lifecycle operators require the canonical approved runtime activation.");
  }
  if (
    !record
    || typeof record !== "object"
    || record.schema !== POSTHOG_CANARY_LIFECYCLE_SCHEMA
    || record.mode !== "sanitized-evidence-only"
    || record.attemptCount !== 1
    || canonicalJson(record.policy) !== canonicalJson(expectedLifecyclePolicy())
  ) {
    throw new Error("PostHog lifecycle operators require the canonical sanitized lifecycle record.");
  }
  if (
    activation.approvalId !== record.approvalId
    || activation.claimId !== record.claimId
    || activation.requestId !== record.requestId
    || activation.project !== record.project
    || activation.origin !== record.origin
    || activation.operation !== record.operation
    || activation.adapterRevision !== record.adapterRevision
  ) {
    throw new Error("PostHog lifecycle operator activation binding drifted from the lifecycle record.");
  }
  if (
    record.disable.status !== "required-actions-not-executed"
    || canonicalJson(record.disable.actions) !== canonicalJson(POSTHOG_CANARY_DISABLE_ACTIONS)
    || record.disable.deleteSanitizedEvidenceBy !== record.retention.deleteBy
  ) {
    throw new Error("PostHog lifecycle operator disable requirements drifted from the canonical lifecycle record.");
  }
}

function assertFinalization(
  record: PostHogCanaryLifecycleRecord,
  finalization: PostHogCanaryFinalizationResult,
): string {
  if (
    !finalization
    || typeof finalization !== "object"
    || finalization.schema !== POSTHOG_CANARY_FINALIZATION_SCHEMA
    || finalization.status !== "finalized"
    || typeof finalization.finalizationId !== "string"
    || Object.keys(finalization).sort().join(",") !== "approvalId,claimId,finalizationId,lifecycleId,policy,schema,status,terminalState"
    || "rejectionReason" in finalization
    || canonicalJson(finalization.policy) !== canonicalJson(expectedFinalizationPolicy())
  ) {
    throw new Error("PostHog lifecycle operators require a successful canonical lifecycle finalization.");
  }
  const terminalState = record.outcome === "succeeded" ? "consumed" : "invalidated";
  if (
    finalization.approvalId !== record.approvalId
    || finalization.claimId !== record.claimId
    || finalization.lifecycleId !== record.id
    || finalization.terminalState !== terminalState
  ) {
    throw new Error("PostHog lifecycle operator finalization binding drifted from the lifecycle record.");
  }
  return normalizeText(finalization.finalizationId, "finalization.finalizationId", 128);
}

function assertOperatorWindow(record: PostHogCanaryLifecycleRecord, value: string, name: string): string {
  const normalized = normalizeUtc(value, name);
  const epoch = Date.parse(normalized);
  if (epoch < Date.parse(record.endedAt)) {
    throw new Error(`${name} may not precede the lifecycle end time.`);
  }
  if (epoch > Date.parse(record.retention.deleteBy)) {
    throw new Error(`${name} exceeds the sanitized-evidence deletion deadline.`);
  }
  return normalized;
}

function normalizeActionEvidence(
  values: readonly PostHogCanaryLifecycleActionEvidence[],
): readonly PostHogCanaryLifecycleActionEvidence[] {
  if (!Array.isArray(values) || values.length !== POSTHOG_CANARY_DISABLE_ACTIONS.length) {
    throw new Error("PostHog lifecycle operator evidence must cover every required disable action exactly once.");
  }
  const normalized = values.map((value) => {
    if (
      !value
      || typeof value !== "object"
      || Object.keys(value).sort().join(",") !== "action,evidenceId"
      || !POSTHOG_CANARY_DISABLE_ACTIONS.includes(value.action)
    ) {
      throw new Error("PostHog lifecycle operator action evidence is malformed.");
    }
    return Object.freeze({
      action: value.action,
      evidenceId: normalizeText(
        value.evidenceId,
        `actionEvidence.${value.action}.evidenceId`,
        defaultPostHogCanaryLifecycleOperatorLimits.maxEvidenceIdLength,
      ),
    });
  });
  const byAction = new Map(normalized.map((value) => [value.action, value]));
  if (byAction.size !== POSTHOG_CANARY_DISABLE_ACTIONS.length) {
    throw new Error("PostHog lifecycle operator evidence contains duplicate disable actions.");
  }
  return Object.freeze(POSTHOG_CANARY_DISABLE_ACTIONS.map((action) => {
    const evidence = byAction.get(action);
    if (!evidence) throw new Error(`PostHog lifecycle operator evidence is missing ${action}.`);
    return evidence;
  }));
}

function normalizeOperatorEvidence(
  plan: PostHogCanaryLifecycleOperatorPlan,
  record: PostHogCanaryLifecycleRecord,
  value: PostHogCanaryLifecycleOperatorEvidence,
  postOperatorAt: string,
): PostHogCanaryLifecycleOperatorEvidence {
  if (!value || typeof value !== "object") throw new Error("PostHog lifecycle operator evidence is required.");
  if (
    Object.keys(value).sort().join(",")
    !== "actionEvidence,completedAt,lifecycleId,planId,retentionEvidenceId,schema"
  ) {
    throw new Error("PostHog lifecycle operator evidence contains unsupported fields.");
  }
  if (
    value.schema !== POSTHOG_CANARY_LIFECYCLE_OPERATOR_EVIDENCE_SCHEMA
    || value.planId !== plan.id
    || value.lifecycleId !== record.id
  ) {
    throw new Error("PostHog lifecycle operator evidence drifted from the exact operator plan.");
  }
  const completedAt = assertOperatorWindow(record, value.completedAt, "operatorEvidence.completedAt");
  if (
    Date.parse(completedAt) < Date.parse(plan.plannedAt)
    || Date.parse(completedAt) > Date.parse(postOperatorAt)
  ) {
    throw new Error("PostHog lifecycle operator evidence completedAt is outside the observed operator interval.");
  }
  const retentionEvidenceId = normalizeText(
    value.retentionEvidenceId,
    "operatorEvidence.retentionEvidenceId",
    defaultPostHogCanaryLifecycleOperatorLimits.maxEvidenceIdLength,
  );
  const actionEvidence = normalizeActionEvidence(value.actionEvidence);
  return Object.freeze({
    schema: POSTHOG_CANARY_LIFECYCLE_OPERATOR_EVIDENCE_SCHEMA,
    planId: plan.id,
    lifecycleId: record.id,
    completedAt,
    retentionEvidenceId,
    actionEvidence,
  });
}

export async function executePostHogCanaryLifecycleOperatorBoundary(
  activation: PostHogCanaryRuntimeActivation,
  record: PostHogCanaryLifecycleRecord,
  finalization: PostHogCanaryFinalizationResult,
  dependencies: PostHogCanaryLifecycleOperatorDependencies,
): Promise<PostHogCanaryLifecycleOperatorResult> {
  assertActivationRecordBinding(activation, record);
  const finalizationId = assertFinalization(record, finalization);
  if (!dependencies || typeof dependencies !== "object") {
    throw new Error("PostHog lifecycle operator dependencies are required.");
  }
  if (typeof dependencies.operator !== "function") {
    throw new Error("An injected PostHog lifecycle operator is required.");
  }
  if (typeof dependencies.now !== "function") {
    throw new Error("An injected PostHog lifecycle operator UTC clock is required.");
  }

  const plannedAt = assertOperatorWindow(record, dependencies.now(), "operator.plannedAt");
  const canonical = Object.freeze({
    activationId: activation.id,
    approvalId: record.approvalId,
    claimId: record.claimId,
    requestId: record.requestId,
    lifecycleId: record.id,
    finalizationId,
    project: record.project,
    origin: record.origin,
    operation: record.operation,
    credentialRef: activation.credentialRef,
    killSwitchRef: activation.killSwitchRef,
    evidenceDestinationRef: record.retention.evidenceDestinationRef,
    sanitizedArtifactSha256: record.sanitizedArtifactSha256,
    deleteBy: record.retention.deleteBy,
    plannedAt,
    actions: [...POSTHOG_CANARY_DISABLE_ACTIONS] as readonly PostHogCanaryDisableAction[],
  });
  const identity = await sha256Hex(canonicalJson(canonical));
  const plan: PostHogCanaryLifecycleOperatorPlan = Object.freeze({
    schema: POSTHOG_CANARY_LIFECYCLE_OPERATOR_PLAN_SCHEMA,
    id: `posthog_canary_lifecycle_operator_plan_${identity}`,
    activationId: canonical.activationId,
    approvalId: canonical.approvalId,
    claimId: canonical.claimId,
    requestId: canonical.requestId,
    lifecycleId: canonical.lifecycleId,
    finalizationId: canonical.finalizationId,
    project: canonical.project,
    origin: canonical.origin,
    operation: canonical.operation,
    credentialRef: canonical.credentialRef,
    killSwitchRef: canonical.killSwitchRef,
    evidenceDestinationRef: canonical.evidenceDestinationRef,
    sanitizedArtifactSha256: canonical.sanitizedArtifactSha256,
    deleteBy: canonical.deleteBy,
    plannedAt: canonical.plannedAt,
    actions: canonical.actions,
  });

  let rawEvidence: PostHogCanaryLifecycleOperatorEvidence;
  try {
    rawEvidence = await dependencies.operator(plan);
  } catch {
    throw new Error("PostHog lifecycle operator execution failed.");
  }

  const postOperatorAt = assertOperatorWindow(record, dependencies.now(), "operator.completedObservationAt");
  if (Date.parse(postOperatorAt) < Date.parse(plannedAt)) {
    throw new Error("PostHog lifecycle operator clock moved backwards.");
  }
  const evidence = normalizeOperatorEvidence(plan, record, rawEvidence, postOperatorAt);

  return Object.freeze({
    schema: POSTHOG_CANARY_LIFECYCLE_OPERATOR_RESULT_SCHEMA,
    status: "qualified" as const,
    planId: plan.id,
    lifecycleId: record.id,
    evidenceId: evidence.retentionEvidenceId,
    completedAt: evidence.completedAt,
    actionEvidence: evidence.actionEvidence,
    policy: resultPolicy(),
  });
}
