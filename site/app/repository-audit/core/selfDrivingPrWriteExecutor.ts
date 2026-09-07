import {
  SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA,
  type SelfDrivingPrWriteExecutionPlan,
} from "./selfDrivingPrWriteExecutionPlan";
import {
  finalizeSelfDrivingPrWriteClaim,
  type SelfDrivingPrWriteFailureStage,
  type SelfDrivingPrWriteFinalizationResult,
  type SelfDrivingPrWriteFinalizer,
} from "./selfDrivingPrWriteFinalization";

export const SELF_DRIVING_PR_WRITE_EXECUTOR_SCHEMA =
  "solvelang.self-driving.pr-write-executor.v0" as const;
export const SELF_DRIVING_PR_WRITE_LIVE_PREFLIGHT_SCHEMA =
  "solvelang.self-driving.pr-write-live-preflight.v0" as const;

export const defaultSelfDrivingPrWriteExecutorLimits = Object.freeze({
  maxClaimAgeMs: 5 * 60 * 1000,
  maxLivePreflightAgeMs: 2 * 60 * 1000,
  maxPullRequestRefLength: 256,
  maxLiveChecks: 4,
  maxWriteCalls: 3,
});

export type SelfDrivingPrWriteLivePreflight = Readonly<{
  schema: typeof SELF_DRIVING_PR_WRITE_LIVE_PREFLIGHT_SCHEMA;
  status: "ready";
  observedAt: string;
  repository: string;
  baseBranch: string;
  baseRevision: string;
  headBranch: string;
  headBranchExists: false;
  branchProtection: Readonly<{
    protectedBranches: readonly string[];
    requiresPullRequest: true;
    allowsForcePush: false;
    requiredApprovals: number;
    requiredChecks: readonly string[];
  }>;
  files: readonly Readonly<{
    path: string;
    blobSha: string;
  }>[];
}>;

export type SelfDrivingPrWriteBranchRequest = Readonly<{
  planId: string;
  repository: string;
  baseRevision: string;
  headBranch: string;
}>;

export type SelfDrivingPrWriteCommitRequest = Readonly<{
  planId: string;
  repository: string;
  headBranch: string;
  expectedParentRevision: string;
  files: SelfDrivingPrWriteExecutionPlan["files"];
}>;

export type SelfDrivingPrWritePullRequestRequest = Readonly<{
  planId: string;
  repository: string;
  baseBranch: string;
  headBranch: string;
  headRevision: string;
  title: string;
  body: string;
}>;

export type SelfDrivingPrWriteAdapter = Readonly<{
  verifyLivePreflight: (
    plan: SelfDrivingPrWriteExecutionPlan,
    signal?: AbortSignal,
  ) => Promise<SelfDrivingPrWriteLivePreflight>;
  createBranch: (
    request: SelfDrivingPrWriteBranchRequest,
    signal?: AbortSignal,
  ) => Promise<Readonly<{ status: "created"; branch: string; revision: string }>>;
  createCommit: (
    request: SelfDrivingPrWriteCommitRequest,
    signal?: AbortSignal,
  ) => Promise<Readonly<{
    status: "committed";
    branch: string;
    parentRevision: string;
    commitSha: string;
  }>>;
  openPullRequest: (
    request: SelfDrivingPrWritePullRequestRequest,
    signal?: AbortSignal,
  ) => Promise<Readonly<{
    status: "opened";
    repository: string;
    baseBranch: string;
    headBranch: string;
    headRevision: string;
    pullRequestRef: string;
  }>>;
}>;

export type SelfDrivingPrWriteExecutorDependencies = Readonly<{
  adapter: SelfDrivingPrWriteAdapter;
  finalizer: SelfDrivingPrWriteFinalizer;
  now: () => string;
  signal?: AbortSignal;
}>;

export type SelfDrivingPrWriteExecutorResult = Readonly<{
  schema: typeof SELF_DRIVING_PR_WRITE_EXECUTOR_SCHEMA;
  status: "succeeded" | "failed" | "cancelled" | "terminal-state-unconfirmed";
  outcome: "succeeded" | "failed" | "cancelled";
  planId: string;
  repository: string;
  baseBranch: string;
  headBranch: string;
  startedAt: string;
  completedAt: string;
  failureStage?: SelfDrivingPrWriteFailureStage;
  stoppedStage?: SelfDrivingPrWriteFailureStage;
  commitSha?: string;
  pullRequestRef?: string;
  sideEffectState:
    | "none"
    | "head-branch-may-exist"
    | "commit-may-exist"
    | "pull-request-may-exist"
    | "pull-request-opened";
  attempts: Readonly<{
    livePreflight: 0 | 1;
    createBranch: 0 | 1;
    createCommit: 0 | 1;
    openPullRequest: 0 | 1;
    finalization: 1;
  }>;
  finalization: SelfDrivingPrWriteFinalizationResult;
  policy: Readonly<{
    injectedAdapterRequired: true;
    builtInCredentialResolver: false;
    builtInNetworkClient: false;
    exactPlanSha256Required: true;
    exactBaseRevisionVerified: true;
    freshBranchProtectionVerified: true;
    absentHeadBranchVerified: true;
    exactBaseBlobShasVerified: true;
    oneShotWriteSequence: true;
    retries: 0;
    directPushToBaseAllowed: false;
    directPushToProtectedBranchAllowed: false;
    forcePushAllowed: false;
    automaticMergeAllowed: false;
    terminalFinalizationRequired: true;
    credentialMaterialReturned: false;
    providerAccess: false;
    productionMutationAccess: false;
    billingMutationAccess: false;
    solveRunnerAuthority: false;
    externalSideEffects: true;
  }>;
}>;

const textEncoder = new TextEncoder();
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

function normalizeRevision(value: string, name: string): string {
  const normalized = normalizeText(value, name, 64).toLowerCase();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(normalized)) {
    throw new Error(`${name} must be an exact 40- or 64-hex revision.`);
  }
  return normalized;
}

function normalizeCommitSha(value: string): string {
  const normalized = normalizeText(value, "commitSha", 40).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error("commitSha must be an exact 40-hex Git revision.");
  return normalized;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 support is required for PR write execution.");
  const digest = await subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertCanonicalPlan(plan: SelfDrivingPrWriteExecutionPlan): Promise<void> {
  if (!plan || typeof plan !== "object" || plan.schema !== SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA) {
    throw new Error("A canonical PR write execution plan is required.");
  }
  if (plan.mode !== "no-write-execution-plan" || plan.status !== "ready-for-separate-github-executor") {
    throw new Error("PR write executor requires the canonical no-write execution plan.");
  }
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
    throw new Error("PR write executor requires the safe no-write execution-plan policy.");
  }
  if (plan.plannedActions.length !== 3
    || plan.plannedActions[0] !== "create-branch"
    || plan.plannedActions[1] !== "create-commit"
    || plan.plannedActions[2] !== "open-pr") {
    throw new Error("PR write executor requires the exact one-shot write action sequence.");
  }
  if (plan.requiredLiveChecks.length !== defaultSelfDrivingPrWriteExecutorLimits.maxLiveChecks) {
    throw new Error("PR write executor requires the complete live-check contract.");
  }
  const canonicalPlan = {
    repository: plan.repository,
    baseBranch: plan.baseBranch,
    baseRevision: plan.baseRevision,
    headBranch: plan.headBranch,
    installationRef: plan.installationRef,
    approvalId: plan.approvalId,
    approvalBindingSha256: plan.approvalBindingSha256,
    claimId: plan.claimId,
    claimedAt: plan.claimedAt,
    requiredPermissions: plan.requiredPermissions,
    plannedActions: plan.plannedActions,
    requiredLiveChecks: plan.requiredLiveChecks,
    branchProtectionEvidence: plan.branchProtectionEvidence,
    selectedProposals: plan.selectedProposals,
    files: plan.files,
    limits: plan.limits,
    totals: plan.totals,
  };
  const expected = `pr_write_plan_${await sha256Hex(JSON.stringify(canonicalPlan))}`;
  if (plan.id !== expected) throw new Error("PR write execution plan SHA-256 identity does not match its canonical contents.");
}

function assertAdapter(dependencies: SelfDrivingPrWriteExecutorDependencies): void {
  if (!dependencies || typeof dependencies !== "object") throw new Error("PR write executor dependencies are required.");
  if (!dependencies.adapter || typeof dependencies.adapter !== "object") throw new Error("An injected PR write adapter is required.");
  for (const method of ["verifyLivePreflight", "createBranch", "createCommit", "openPullRequest"] as const) {
    if (typeof dependencies.adapter[method] !== "function") throw new Error(`Injected PR write adapter is missing ${method}.`);
  }
  if (typeof dependencies.finalizer !== "function") throw new Error("An injected terminal PR write finalizer is required.");
  if (typeof dependencies.now !== "function") throw new Error("An injected UTC clock is required.");
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("PR write execution cancelled.", "AbortError");
}

function sideEffectForStage(stage: SelfDrivingPrWriteFailureStage): SelfDrivingPrWriteExecutorResult["sideEffectState"] {
  if (stage === "live-preflight") return "none";
  if (stage === "create-branch") return "head-branch-may-exist";
  if (stage === "create-commit") return "commit-may-exist";
  return "pull-request-may-exist";
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");
}

function normalizeLivePreflight(
  plan: SelfDrivingPrWriteExecutionPlan,
  live: SelfDrivingPrWriteLivePreflight,
  startedAt: string,
): void {
  if (!live || typeof live !== "object" || live.schema !== SELF_DRIVING_PR_WRITE_LIVE_PREFLIGHT_SCHEMA || live.status !== "ready") {
    throw new Error("Live PR write preflight did not return the canonical ready contract.");
  }
  if (live.repository !== plan.repository || live.baseBranch !== plan.baseBranch || live.headBranch !== plan.headBranch) {
    throw new Error("Live PR write preflight repository or branch binding drifted.");
  }
  if (normalizeRevision(live.baseRevision, "live.baseRevision") !== plan.baseRevision) {
    throw new Error("Live protected base revision does not match the reviewed plan.");
  }
  if (live.headBranchExists !== false) throw new Error("Planned PR head branch already exists.");
  const observedAt = normalizeUtcTimestamp(live.observedAt, "live.observedAt");
  const observedEpoch = Date.parse(observedAt);
  const startedEpoch = Date.parse(startedAt);
  if (observedEpoch > startedEpoch) throw new Error("Live PR write preflight evidence may not be future-dated.");
  if (startedEpoch - observedEpoch > defaultSelfDrivingPrWriteExecutorLimits.maxLivePreflightAgeMs) {
    throw new Error("Live PR write preflight evidence is stale.");
  }
  if (observedAt < plan.claimedAt) throw new Error("Live PR write preflight must be observed after the authorization claim.");

  const protection = live.branchProtection;
  if (!protection || protection.requiresPullRequest !== true || protection.allowsForcePush !== false) {
    throw new Error("Live branch protection no longer preserves pull-request-only, no-force-push policy.");
  }
  if (!Number.isSafeInteger(protection.requiredApprovals)
    || protection.requiredApprovals < plan.branchProtectionEvidence.requiredApprovals) {
    throw new Error("Live branch protection requires fewer approvals than the reviewed plan.");
  }
  const protectedBranches = [...protection.protectedBranches].sort(compareText);
  if (!protectedBranches.includes(plan.baseBranch) || protectedBranches.includes(plan.headBranch)) {
    throw new Error("Live protected-branch set is incompatible with the reviewed plan.");
  }
  const liveChecks = new Set(protection.requiredChecks);
  for (const required of plan.branchProtectionEvidence.requiredChecks) {
    if (!liveChecks.has(required)) throw new Error(`Live branch protection is missing required check ${required}.`);
  }

  if (!Array.isArray(live.files) || live.files.length !== plan.files.length) {
    throw new Error("Live base-blob evidence must cover every planned file exactly once.");
  }
  const expectedFiles = new Map(plan.files.map((file) => [file.path, file.baseBlobSha]));
  const seen = new Set<string>();
  for (const file of live.files) {
    const path = normalizeText(file.path, "live.files.path", 512);
    if (seen.has(path)) throw new Error("Live base-blob evidence contains duplicate paths.");
    seen.add(path);
    const expected = expectedFiles.get(path);
    if (!expected) throw new Error(`Live base-blob evidence contains unexpected path ${path}.`);
    if (normalizeRevision(file.blobSha, `live.files[${path}].blobSha`) !== expected) {
      throw new Error(`Live base blob changed for ${path}.`);
    }
  }
}

function normalizePullRequestRef(value: string): string {
  const normalized = normalizeText(
    value,
    "pullRequestRef",
    defaultSelfDrivingPrWriteExecutorLimits.maxPullRequestRefLength,
  );
  if (/^https?:\/\//i.test(normalized)) throw new Error("pullRequestRef must be an opaque reference, not a URL.");
  return normalized;
}

function resultPolicy(): SelfDrivingPrWriteExecutorResult["policy"] {
  return Object.freeze({
    injectedAdapterRequired: true,
    builtInCredentialResolver: false,
    builtInNetworkClient: false,
    exactPlanSha256Required: true,
    exactBaseRevisionVerified: true,
    freshBranchProtectionVerified: true,
    absentHeadBranchVerified: true,
    exactBaseBlobShasVerified: true,
    oneShotWriteSequence: true,
    retries: 0,
    directPushToBaseAllowed: false,
    directPushToProtectedBranchAllowed: false,
    forcePushAllowed: false,
    automaticMergeAllowed: false,
    terminalFinalizationRequired: true,
    credentialMaterialReturned: false,
    providerAccess: false,
    productionMutationAccess: false,
    billingMutationAccess: false,
    solveRunnerAuthority: false,
    externalSideEffects: true,
  });
}

export async function executeSelfDrivingPrWritePlan(
  plan: SelfDrivingPrWriteExecutionPlan,
  dependencies: SelfDrivingPrWriteExecutorDependencies,
): Promise<SelfDrivingPrWriteExecutorResult> {
  await assertCanonicalPlan(plan);
  assertAdapter(dependencies);
  const startedAt = normalizeUtcTimestamp(dependencies.now(), "startedAt");
  const claimAge = Date.parse(startedAt) - Date.parse(plan.claimedAt);
  if (claimAge < 0) throw new Error("PR write execution cannot start before the authorization claim.");
  if (claimAge > defaultSelfDrivingPrWriteExecutorLimits.maxClaimAgeMs) {
    throw new Error("PR write authorization claim is too old for execution.");
  }

  let stage: SelfDrivingPrWriteFailureStage = "live-preflight";
  let livePreflight: 0 | 1 = 0;
  let createBranch: 0 | 1 = 0;
  let createCommit: 0 | 1 = 0;
  let openPullRequest: 0 | 1 = 0;
  let commitSha: string | undefined;
  let pullRequestRef: string | undefined;
  let outcome: "succeeded" | "failed" | "cancelled" = "failed";
  let sideEffectState: SelfDrivingPrWriteExecutorResult["sideEffectState"] = "none";

  try {
    assertNotAborted(dependencies.signal);
    livePreflight = 1;
    const live = await dependencies.adapter.verifyLivePreflight(plan, dependencies.signal);
    normalizeLivePreflight(plan, live, startedAt);

    assertNotAborted(dependencies.signal);
    stage = "create-branch";
    createBranch = 1;
    const branch = await dependencies.adapter.createBranch(Object.freeze({
      planId: plan.id,
      repository: plan.repository,
      baseRevision: plan.baseRevision,
      headBranch: plan.headBranch,
    }), dependencies.signal);
    if (!branch || branch.status !== "created" || branch.branch !== plan.headBranch
      || normalizeRevision(branch.revision, "created branch revision") !== plan.baseRevision) {
      throw new Error("Created branch result does not match the reviewed execution plan.");
    }

    assertNotAborted(dependencies.signal);
    stage = "create-commit";
    createCommit = 1;
    const commit = await dependencies.adapter.createCommit(Object.freeze({
      planId: plan.id,
      repository: plan.repository,
      headBranch: plan.headBranch,
      expectedParentRevision: plan.baseRevision,
      files: plan.files,
    }), dependencies.signal);
    if (!commit || commit.status !== "committed" || commit.branch !== plan.headBranch
      || normalizeRevision(commit.parentRevision, "commit parent revision") !== plan.baseRevision) {
      throw new Error("Commit result does not match the reviewed execution plan.");
    }
    commitSha = normalizeCommitSha(commit.commitSha);

    assertNotAborted(dependencies.signal);
    stage = "open-pr";
    openPullRequest = 1;
    const opened = await dependencies.adapter.openPullRequest(Object.freeze({
      planId: plan.id,
      repository: plan.repository,
      baseBranch: plan.baseBranch,
      headBranch: plan.headBranch,
      headRevision: commitSha,
      title: "Solve Self-Driving: reviewed validated change",
      body: `Self-Driving execution plan ${plan.id}. Automatic merge is disabled.`,
    }), dependencies.signal);
    if (!opened || opened.status !== "opened" || opened.repository !== plan.repository
      || opened.baseBranch !== plan.baseBranch || opened.headBranch !== plan.headBranch
      || normalizeCommitSha(opened.headRevision) !== commitSha) {
      throw new Error("Pull request result does not match the reviewed execution plan.");
    }
    pullRequestRef = normalizePullRequestRef(opened.pullRequestRef);
    outcome = "succeeded";
    sideEffectState = "pull-request-opened";
  } catch (error) {
    outcome = isCancellation(error, dependencies.signal) ? "cancelled" : "failed";
    sideEffectState = sideEffectForStage(stage);
  }

  const completedAt = normalizeUtcTimestamp(dependencies.now(), "completedAt");
  const finalizationEvidence = outcome === "succeeded"
    ? Object.freeze({ outcome, startedAt, completedAt, attempts: 1 as const, commitSha, pullRequestRef })
    : outcome === "failed"
      ? Object.freeze({ outcome, startedAt, completedAt, attempts: 1 as const, failureStage: stage })
      : Object.freeze({ outcome, startedAt, completedAt, attempts: 1 as const });
  const finalization = await finalizeSelfDrivingPrWriteClaim(plan, finalizationEvidence, dependencies.finalizer);
  const terminalConfirmed = finalization.status === "finalized";

  return Object.freeze({
    schema: SELF_DRIVING_PR_WRITE_EXECUTOR_SCHEMA,
    status: terminalConfirmed ? outcome : "terminal-state-unconfirmed",
    outcome,
    planId: plan.id,
    repository: plan.repository,
    baseBranch: plan.baseBranch,
    headBranch: plan.headBranch,
    startedAt,
    completedAt,
    ...(outcome === "failed" ? { failureStage: stage } : {}),
    ...(outcome === "cancelled" ? { stoppedStage: stage } : {}),
    ...(commitSha ? { commitSha } : {}),
    ...(pullRequestRef ? { pullRequestRef } : {}),
    sideEffectState,
    attempts: Object.freeze({
      livePreflight,
      createBranch,
      createCommit,
      openPullRequest,
      finalization: 1 as const,
    }),
    finalization,
    policy: resultPolicy(),
  });
}
