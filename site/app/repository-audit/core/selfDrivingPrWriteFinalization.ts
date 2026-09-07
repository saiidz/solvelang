import {
  SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA,
  type SelfDrivingPrWriteExecutionPlan,
} from "./selfDrivingPrWriteExecutionPlan";

export const SELF_DRIVING_PR_WRITE_FINALIZATION_SCHEMA =
  "solvelang.self-driving.pr-write-finalization.v0" as const;

export const SELF_DRIVING_PR_WRITE_OUTCOMES = [
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type SelfDrivingPrWriteOutcome = (typeof SELF_DRIVING_PR_WRITE_OUTCOMES)[number];

export const SELF_DRIVING_PR_WRITE_FAILURE_STAGES = [
  "live-preflight",
  "create-branch",
  "create-commit",
  "open-pr",
] as const;
export type SelfDrivingPrWriteFailureStage = (typeof SELF_DRIVING_PR_WRITE_FAILURE_STAGES)[number];

export type SelfDrivingPrWriteAttemptEvidence = Readonly<{
  outcome: SelfDrivingPrWriteOutcome;
  startedAt: string;
  completedAt: string;
  attempts: number;
  failureStage?: SelfDrivingPrWriteFailureStage;
  commitSha?: string;
  pullRequestRef?: string;
}>;

export type SelfDrivingPrWriteFinalizerRequest = Readonly<{
  schema: typeof SELF_DRIVING_PR_WRITE_FINALIZATION_SCHEMA;
  expectedClaimState: "claimed";
  claimId: string;
  approvalId: string;
  approvalBindingSha256: string;
  planId: string;
  terminalState: "consumed" | "invalidated";
  outcome: SelfDrivingPrWriteOutcome;
  completedAt: string;
  evidence: SelfDrivingPrWriteAttemptEvidence;
}>;

export const SELF_DRIVING_PR_WRITE_FINALIZER_REJECTION_REASONS = [
  "claim-not-found",
  "already-finalized",
  "binding-mismatch",
  "store-rejected",
] as const;
export type SelfDrivingPrWriteFinalizerRejectionReason =
  (typeof SELF_DRIVING_PR_WRITE_FINALIZER_REJECTION_REASONS)[number];

export type SelfDrivingPrWriteFinalizerDependencyResult =
  | { status: "finalized"; finalizationId: string }
  | { status: "rejected"; reason: SelfDrivingPrWriteFinalizerRejectionReason };

export type SelfDrivingPrWriteFinalizer = (
  request: SelfDrivingPrWriteFinalizerRequest,
) => Promise<SelfDrivingPrWriteFinalizerDependencyResult>;

export type SelfDrivingPrWriteFinalizationResult = Readonly<{
  schema: typeof SELF_DRIVING_PR_WRITE_FINALIZATION_SCHEMA;
  status: "finalized" | "rejected";
  claimId: string;
  approvalId: string;
  approvalBindingSha256: string;
  planId: string;
  terminalState: "consumed" | "invalidated";
  outcome: SelfDrivingPrWriteOutcome;
  completedAt: string;
  finalizationId?: string;
  rejectionReason?: SelfDrivingPrWriteFinalizerRejectionReason | "finalizer-failure" | "invalid-finalizer-result";
  policy: Readonly<{
    terminalFinalizationRequired: true;
    successConsumesClaim: true;
    failureOrCancellationInvalidatesClaim: true;
    finalizerMutationAttempted: true;
    retries: 0;
    automaticRearm: false;
    githubApiAccess: false;
    credentialResolutionAccess: false;
    repositoryWriteAccess: false;
    providerAccess: false;
    networkAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    billingMutationAccess: false;
    solveRunnerAuthority: false;
    credentialMaterialReturned: false;
  }>;
}>;

export const defaultSelfDrivingPrWriteFinalizationLimits = Object.freeze({
  maxFinalizationIdLength: 128,
  maxPullRequestRefLength: 256,
  maxAttemptDurationMs: 60_000,
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

function normalizeText(value: string, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character bound.`);
  if (/[\r\n\u0000-\u001f]/.test(normalized)) throw new Error(`${name} must be single-line text.`);
  if (credentialLikePatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error(`${name} contains credential-like material.`);
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

function normalizeCommitSha(value: string): string {
  const normalized = normalizeText(value, "commitSha", 40).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error("commitSha must be an exact 40-hex Git revision.");
  return normalized;
}

function assertSafePlan(plan: SelfDrivingPrWriteExecutionPlan): void {
  if (!plan || typeof plan !== "object" || plan.schema !== SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA) {
    throw new Error("A canonical PR write execution plan is required.");
  }
  if (plan.mode !== "no-write-execution-plan" || plan.status !== "ready-for-separate-github-executor") {
    throw new Error("PR write finalization requires the no-write execution-plan contract.");
  }
  if (!/^pr_write_plan_[0-9a-f]{64}$/.test(plan.id)) throw new Error("Execution plan ID is malformed.");
  if (!/^[0-9a-f]{64}$/.test(plan.approvalBindingSha256)) throw new Error("Execution plan approval binding is malformed.");
  const policy = plan.policy;
  if (
    !policy
    || policy.sourceArtifactsRecreated !== true
    || policy.cryptographicApprovalBindingVerified !== true
    || policy.successfulSingleUseClaimRequired !== true
    || policy.exactBaseRevisionRequiredAtExecution !== true
    || policy.freshBranchProtectionRequiredAtExecution !== true
    || policy.headBranchMustNotExistAtExecution !== true
    || policy.baseBlobShaMatchRequiredAtExecution !== true
    || policy.directPushToBaseAllowed !== false
    || policy.directPushToProtectedBranchAllowed !== false
    || policy.forcePushAllowed !== false
    || policy.automaticMergeAllowed !== false
    || policy.credentialResolutionAccess !== false
    || policy.githubApiAccess !== false
    || policy.branchCreationAccess !== false
    || policy.commitWriteAccess !== false
    || policy.pullRequestCreationAccess !== false
    || policy.patchApplicationAccess !== false
    || policy.shellExecutionAccess !== false
    || policy.repositoryWriteAccess !== false
    || policy.providerAccess !== false
    || policy.networkAccess !== false
    || policy.rolloutMutationAccess !== false
    || policy.productionMutationAccess !== false
    || policy.billingMutationAccess !== false
    || policy.solveRunnerAuthority !== false
    || policy.externalSideEffects !== false
    || policy.writeExecutionStatus !== "not-executed"
  ) {
    throw new Error("PR write finalization requires the safe no-write execution-plan policy.");
  }
}

function normalizeEvidence(
  plan: SelfDrivingPrWriteExecutionPlan,
  input: SelfDrivingPrWriteAttemptEvidence,
): SelfDrivingPrWriteAttemptEvidence {
  if (!input || typeof input !== "object") throw new Error("PR write attempt evidence is required.");
  if (!SELF_DRIVING_PR_WRITE_OUTCOMES.includes(input.outcome)) throw new Error("PR write outcome is unsupported.");
  if (!Number.isSafeInteger(input.attempts) || input.attempts !== 1) {
    throw new Error("PR write finalization requires exactly one write attempt.");
  }
  const startedAt = normalizeUtcTimestamp(input.startedAt, "startedAt");
  const completedAt = normalizeUtcTimestamp(input.completedAt, "completedAt");
  const duration = Date.parse(completedAt) - Date.parse(startedAt);
  if (duration < 0) throw new Error("completedAt must not precede startedAt.");
  if (duration > defaultSelfDrivingPrWriteFinalizationLimits.maxAttemptDurationMs) {
    throw new Error("PR write attempt exceeded the 60-second finalization evidence bound.");
  }
  if (startedAt < plan.claimedAt) throw new Error("PR write attempt cannot start before the claim timestamp.");

  if (input.outcome === "succeeded") {
    if (input.failureStage !== undefined) throw new Error("Successful PR write evidence may not include a failure stage.");
    const commitSha = normalizeCommitSha(input.commitSha ?? "");
    const pullRequestRef = normalizeText(
      input.pullRequestRef ?? "",
      "pullRequestRef",
      defaultSelfDrivingPrWriteFinalizationLimits.maxPullRequestRefLength,
    );
    if (/^https?:\/\//i.test(pullRequestRef)) throw new Error("pullRequestRef must be an opaque reference, not a URL.");
    return Object.freeze({
      outcome: "succeeded",
      startedAt,
      completedAt,
      attempts: 1,
      commitSha,
      pullRequestRef,
    });
  }

  if (input.commitSha !== undefined || input.pullRequestRef !== undefined) {
    throw new Error("Failed or cancelled PR write evidence may not claim a completed commit or pull request.");
  }
  if (input.outcome === "failed") {
    if (!input.failureStage || !SELF_DRIVING_PR_WRITE_FAILURE_STAGES.includes(input.failureStage)) {
      throw new Error("Failed PR write evidence requires a bounded failure stage.");
    }
    return Object.freeze({
      outcome: "failed",
      startedAt,
      completedAt,
      attempts: 1,
      failureStage: input.failureStage,
    });
  }
  if (input.failureStage !== undefined) throw new Error("Cancelled PR write evidence may not claim a failure stage.");
  return Object.freeze({
    outcome: "cancelled",
    startedAt,
    completedAt,
    attempts: 1,
  });
}

function normalizeFinalizerResult(
  value: SelfDrivingPrWriteFinalizerDependencyResult,
): SelfDrivingPrWriteFinalizerDependencyResult | null {
  if (!value || typeof value !== "object") return null;
  if (value.status === "finalized") {
    try {
      return {
        status: "finalized",
        finalizationId: normalizeText(
          value.finalizationId,
          "finalizationId",
          defaultSelfDrivingPrWriteFinalizationLimits.maxFinalizationIdLength,
        ),
      };
    } catch {
      return null;
    }
  }
  if (
    value.status === "rejected"
    && SELF_DRIVING_PR_WRITE_FINALIZER_REJECTION_REASONS.includes(value.reason)
  ) {
    return { status: "rejected", reason: value.reason };
  }
  return null;
}

export async function finalizeSelfDrivingPrWriteClaim(
  plan: SelfDrivingPrWriteExecutionPlan,
  evidenceInput: SelfDrivingPrWriteAttemptEvidence,
  finalizer: SelfDrivingPrWriteFinalizer,
): Promise<SelfDrivingPrWriteFinalizationResult> {
  assertSafePlan(plan);
  const evidence = normalizeEvidence(plan, evidenceInput);
  if (typeof finalizer !== "function") throw new Error("An injected PR write claim finalizer is required.");
  const terminalState = evidence.outcome === "succeeded" ? "consumed" : "invalidated";
  const request: SelfDrivingPrWriteFinalizerRequest = Object.freeze({
    schema: SELF_DRIVING_PR_WRITE_FINALIZATION_SCHEMA,
    expectedClaimState: "claimed",
    claimId: plan.claimId,
    approvalId: plan.approvalId,
    approvalBindingSha256: plan.approvalBindingSha256,
    planId: plan.id,
    terminalState,
    outcome: evidence.outcome,
    completedAt: evidence.completedAt,
    evidence,
  });

  const base: Omit<SelfDrivingPrWriteFinalizationResult, "status"> = {
    schema: SELF_DRIVING_PR_WRITE_FINALIZATION_SCHEMA,
    claimId: plan.claimId,
    approvalId: plan.approvalId,
    approvalBindingSha256: plan.approvalBindingSha256,
    planId: plan.id,
    terminalState,
    outcome: evidence.outcome,
    completedAt: evidence.completedAt,
    policy: Object.freeze({
      terminalFinalizationRequired: true,
      successConsumesClaim: true,
      failureOrCancellationInvalidatesClaim: true,
      finalizerMutationAttempted: true,
      retries: 0,
      automaticRearm: false,
      githubApiAccess: false,
      credentialResolutionAccess: false,
      repositoryWriteAccess: false,
      providerAccess: false,
      networkAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      billingMutationAccess: false,
      solveRunnerAuthority: false,
      credentialMaterialReturned: false,
    }),
  };

  let dependencyResult: SelfDrivingPrWriteFinalizerDependencyResult;
  try {
    dependencyResult = await finalizer(request);
  } catch {
    return Object.freeze({ ...base, status: "rejected", rejectionReason: "finalizer-failure" });
  }
  const normalized = normalizeFinalizerResult(dependencyResult);
  if (!normalized) {
    return Object.freeze({ ...base, status: "rejected", rejectionReason: "invalid-finalizer-result" });
  }
  if (normalized.status === "rejected") {
    return Object.freeze({ ...base, status: "rejected", rejectionReason: normalized.reason });
  }
  return Object.freeze({ ...base, status: "finalized", finalizationId: normalized.finalizationId });
}
