import type { RepositorySeverity } from "./inventory";
import {
  createSelfDrivingPatchPreview,
  SELF_DRIVING_PATCH_PREVIEW_SCHEMA,
  type SelfDrivingPatchHunkInput,
  type SelfDrivingPatchPreview,
  type SelfDrivingPatchPreviewProposal,
} from "./selfDrivingPatchPreview";
import {
  createSelfDrivingPatchValidation,
  SELF_DRIVING_PATCH_VALIDATION_SCHEMA,
  type SelfDrivingPatchValidation,
} from "./selfDrivingPatchValidation";
import {
  createSelfDrivingPrPreflight,
  SELF_DRIVING_PR_PLANNED_ACTIONS,
  SELF_DRIVING_PR_PREFLIGHT_SCHEMA,
  SELF_DRIVING_PR_REQUIRED_PERMISSIONS,
  type SelfDrivingPrPreflight,
} from "./selfDrivingPrPreflight";
import {
  defaultSelfDrivingPrWriteAuthorizationLimits,
  normalizeSelfDrivingPrWriteApproval,
  SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA,
  SELF_DRIVING_PR_WRITE_CLAIM_SCHEMA,
  type NormalizedSelfDrivingPrWriteApproval,
  type SelfDrivingPrWriteClaimResult,
} from "./selfDrivingPrWriteAuthorization";
import type { SelfDrivingSuggestionPlan } from "./selfDrivingSuggest";

export const SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA = "solvelang.self-driving.pr-write-execution-plan.v0" as const;

export const SELF_DRIVING_PR_WRITE_LIVE_CHECKS = Object.freeze([
  "verify-approval-claim",
  "verify-installation-permissions",
  "verify-base-ref",
  "verify-branch-protection",
  "verify-head-branch-absent",
  "verify-base-blobs",
] as const);

export type SelfDrivingPrWritePlanFile = Readonly<{
  path: string;
  baseBlobSha: string;
  hunks: readonly Readonly<SelfDrivingPatchHunkInput>[];
}>;

export type SelfDrivingPrWritePlanProposal = Readonly<{
  validationId: string;
  patchProposalId: string;
  suggestionProposalId: string;
  findingId: string;
  severity: RepositorySeverity;
  files: readonly SelfDrivingPrWritePlanFile[];
}>;

export type SelfDrivingPrWriteExecutionPlan = Readonly<{
  schema: typeof SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA;
  id: string;
  mode: "no-write-plan";
  status: "ready-for-separate-executor";
  repository: string;
  baseBranch: string;
  baseRevision: string;
  headBranch: string;
  installationRef: string;
  preflightId: string;
  approvalId: string;
  claimId: string;
  claimedAt: string;
  requiredPermissions: typeof SELF_DRIVING_PR_REQUIRED_PERMISSIONS;
  liveChecks: typeof SELF_DRIVING_PR_WRITE_LIVE_CHECKS;
  writeSequence: typeof SELF_DRIVING_PR_PLANNED_ACTIONS;
  commitMessage: "Solve Self-Driving: apply reviewed proposals";
  pullRequestTitle: "Solve Self-Driving: reviewed change proposal";
  proposals: readonly SelfDrivingPrWritePlanProposal[];
  totals: Readonly<{
    proposals: number;
    files: number;
    hunks: number;
    lines: number;
    bytes: number;
  }>;
  policy: Readonly<{
    sourceSuggestionRequired: true;
    sourcePatchPreviewRevalidated: true;
    sourcePatchValidationRevalidated: true;
    sourcePrPreflightRevalidated: true;
    exactApprovalRequired: true;
    successfulSingleUseClaimRequired: true;
    liveBaseRefCheckRequired: true;
    liveBranchProtectionCheckRequired: true;
    liveInstallationPermissionCheckRequired: true;
    liveHeadAbsenceCheckRequired: true;
    liveBaseBlobCheckRequired: true;
    duplicateTargetPathsAllowed: false;
    directPushToBaseAllowed: false;
    directPushToProtectedBranchAllowed: false;
    forcePushAllowed: false;
    autoMergeAllowed: false;
    retries: 0;
    githubApiAccess: false;
    credentialResolutionAccess: false;
    tokenMaterialAccepted: false;
    branchCreationAccess: false;
    commitWriteAccess: false;
    pullRequestCreationAccess: false;
    patchApplicationAccess: false;
    shellExecutionAccess: false;
    repositoryWriteAccess: false;
    mergeAccess: false;
    providerAccess: false;
    networkAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    billingMutationAccess: false;
    solveRunnerAuthority: false;
    externalSideEffects: false;
    writeExecutionStatus: "not-executed";
  }>;
}>;

export const defaultSelfDrivingPrWriteExecutionPlanLimits = Object.freeze({
  maxSelectedProposals: 20,
  maxFiles: 64,
  maxHunks: 256,
  maxLines: 3_000,
  maxBytes: 131_072,
  maxIdentifierLength: 128,
});

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

function normalizeIdentifier(value: string, name: string, maxLength = defaultSelfDrivingPrWriteExecutionPlanLimits.maxIdentifierLength): string {
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
  const normalized = normalizeIdentifier(value, name, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)) {
    throw new Error(`${name} must be an explicit UTC timestamp.`);
  }
  const epoch = Date.parse(normalized);
  if (!Number.isFinite(epoch)) throw new Error(`${name} must be a valid UTC timestamp.`);
  return new Date(epoch).toISOString();
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalPatchPreview(
  suggestionPlan: SelfDrivingSuggestionPlan,
  patchPreview: SelfDrivingPatchPreview,
): SelfDrivingPatchPreview {
  if (!patchPreview || typeof patchPreview !== "object") throw new Error("A Patch Preview artifact is required.");
  if (patchPreview.schema !== SELF_DRIVING_PATCH_PREVIEW_SCHEMA || patchPreview.mode !== "review-only") {
    throw new Error("PR write execution planning requires the canonical review-only Patch Preview schema.");
  }
  if (!Array.isArray(patchPreview.proposals)) throw new Error("Patch Preview proposals must be an array.");

  const rebuilt = createSelfDrivingPatchPreview(
    suggestionPlan,
    patchPreview.repositoryRevision,
    patchPreview.proposals.map((proposal) => ({
      suggestionProposalId: proposal.suggestionProposalId,
      files: proposal.files.map((file) => ({
        path: file.path,
        baseBlobSha: file.baseBlobSha,
        hunks: file.hunks.map((hunk) => ({
          oldStart: hunk.oldStart,
          oldLines: hunk.oldLines,
          newStart: hunk.newStart,
          newLines: hunk.newLines,
          lines: [...hunk.lines],
        })),
      })),
    })),
  );
  if (!sameJson(rebuilt, patchPreview)) {
    throw new Error("Patch Preview does not match its canonical reconstruction from the Suggestion Plan.");
  }
  return rebuilt;
}

function canonicalPatchValidation(
  suggestionPlan: SelfDrivingSuggestionPlan,
  patchPreview: SelfDrivingPatchPreview,
  validation: SelfDrivingPatchValidation,
): SelfDrivingPatchValidation {
  if (!validation || typeof validation !== "object") throw new Error("A Patch Validation artifact is required.");
  if (validation.schema !== SELF_DRIVING_PATCH_VALIDATION_SCHEMA || validation.mode !== "review-only") {
    throw new Error("PR write execution planning requires the canonical review-only Patch Validation schema.");
  }
  if (!Array.isArray(validation.proposals)) throw new Error("Patch Validation proposals must be an array.");

  const rebuilt = createSelfDrivingPatchValidation(
    suggestionPlan,
    patchPreview,
    validation.proposals.map((proposal) => ({
      patchProposalId: proposal.patchProposalId,
      results: proposal.results.map((result) => ({
        kind: result.kind,
        label: result.label,
        status: result.status,
        observedAt: result.observedAt,
        evidenceLocator: result.evidenceLocator,
      })),
    })),
  );
  if (!sameJson(rebuilt, validation)) {
    throw new Error("Patch Validation does not match its canonical reconstruction from Patch Preview evidence.");
  }
  return rebuilt;
}

function canonicalPrPreflight(
  validation: SelfDrivingPatchValidation,
  preflight: SelfDrivingPrPreflight,
): SelfDrivingPrPreflight {
  if (!preflight || typeof preflight !== "object") throw new Error("A PR Preflight artifact is required.");
  if (preflight.schema !== SELF_DRIVING_PR_PREFLIGHT_SCHEMA) {
    throw new Error("PR write execution planning requires the canonical PR Preflight schema.");
  }

  const rebuilt = createSelfDrivingPrPreflight(validation, {
    repository: preflight.repository,
    baseBranch: preflight.baseBranch,
    baseRevision: preflight.baseRevision,
    headBranch: preflight.headBranch,
    installationRef: preflight.installationRef,
    selectedValidationIds: preflight.selectedProposals.map((proposal) => proposal.validationId),
    branchProtection: {
      protectedBranches: [...preflight.branchProtection.protectedBranches],
      requiresPullRequest: preflight.branchProtection.requiresPullRequest,
      allowsForcePush: preflight.branchProtection.allowsForcePush,
      requiredApprovals: preflight.branchProtection.requiredApprovals,
      requiredChecks: [...preflight.branchProtection.requiredChecks],
      observedAt: preflight.branchProtection.observedAt,
      evidenceLocator: preflight.branchProtection.evidenceLocator,
    },
  });
  if (!sameJson(rebuilt, preflight)) {
    throw new Error("PR Preflight does not match its canonical reconstruction from Patch Validation.");
  }
  return rebuilt;
}

function canonicalApproval(
  preflight: SelfDrivingPrPreflight,
  approval: NormalizedSelfDrivingPrWriteApproval,
): NormalizedSelfDrivingPrWriteApproval {
  if (!approval || typeof approval !== "object") throw new Error("A normalized PR write approval is required.");
  if (approval.schema !== SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA || approval.state !== "approved") {
    throw new Error("PR write execution planning requires an approved PR write authorization.");
  }
  const rebuilt = normalizeSelfDrivingPrWriteApproval(preflight, {
    schema: SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA,
    state: "approved",
    approvalId: approval.approvalId,
    preflightId: approval.binding.preflightId,
    repository: approval.binding.repository,
    baseBranch: approval.binding.baseBranch,
    baseRevision: approval.binding.baseRevision,
    headBranch: approval.binding.headBranch,
    installationRef: approval.binding.installationRef,
    operator: approval.operator,
    runtime: approval.runtime,
    notBefore: approval.notBefore,
    expiresAt: approval.expiresAt,
  });
  if (!sameJson(rebuilt, approval)) {
    throw new Error("PR write approval does not match its canonical reconstruction from PR Preflight.");
  }
  return rebuilt;
}

function assertSuccessfulClaim(
  approval: NormalizedSelfDrivingPrWriteApproval,
  claim: SelfDrivingPrWriteClaimResult,
): { claimId: string; requestedAt: string } {
  if (!claim || typeof claim !== "object") throw new Error("A successful PR write approval claim is required.");
  if (claim.schema !== SELF_DRIVING_PR_WRITE_CLAIM_SCHEMA || claim.status !== "claimed") {
    throw new Error("PR write execution planning requires a successful single-use PR write claim.");
  }
  const claimId = normalizeIdentifier(claim.claimId ?? "", "claim.claimId");
  if (normalizeIdentifier(claim.approvalId, "claim.approvalId") !== approval.approvalId) {
    throw new Error("PR write claim approvalId does not match the approved authorization.");
  }
  if (normalizeIdentifier(claim.preflightId, "claim.preflightId") !== approval.binding.preflightId) {
    throw new Error("PR write claim preflightId does not match the approved authorization.");
  }
  if (claim.rejectionReason !== undefined) throw new Error("A claimed PR write authorization may not carry a rejection reason.");
  const requestedAt = normalizeUtcTimestamp(claim.requestedAt, "claim.requestedAt");
  const requestedEpoch = Date.parse(requestedAt);
  if (requestedEpoch < Date.parse(approval.notBefore) || requestedEpoch >= Date.parse(approval.expiresAt)) {
    throw new Error("PR write claim timestamp is outside the approved authorization window.");
  }
  const protectionEpoch = Date.parse(approval.binding.branchProtection.observedAt);
  if (protectionEpoch > requestedEpoch) throw new Error("PR write claim predates its branch-protection evidence.");
  if (requestedEpoch - protectionEpoch > defaultSelfDrivingPrWriteAuthorizationLimits.maxBranchProtectionEvidenceAgeMs) {
    throw new Error("PR write claim is bound to stale branch-protection evidence.");
  }

  const policy = claim.policy;
  if (
    policy.atomicSingleUseClaimRequired !== true
    || policy.freshBranchProtectionEvidenceRequired !== true
    || policy.writeAuthorizationClaimMutationAttempted !== true
    || policy.retries !== 0
    || policy.automaticRearm !== false
    || policy.githubApiAccess !== false
    || policy.credentialResolutionAccess !== false
    || policy.tokenMaterialAccepted !== false
    || policy.branchCreationAccess !== false
    || policy.commitWriteAccess !== false
    || policy.pullRequestCreationAccess !== false
    || policy.patchApplicationAccess !== false
    || policy.shellExecutionAccess !== false
    || policy.directPushToBaseAllowed !== false
    || policy.directPushToProtectedBranchAllowed !== false
    || policy.forcePushAllowed !== false
    || policy.repositoryWriteAccess !== false
    || policy.mergeAccess !== false
    || policy.providerAccess !== false
    || policy.networkAccess !== false
    || policy.rolloutMutationAccess !== false
    || policy.productionMutationAccess !== false
    || policy.billingMutationAccess !== false
    || policy.solveRunnerAuthority !== false
    || policy.credentialMaterialReturned !== false
    || policy.writeExecutionStatus !== "not-executed"
  ) {
    throw new Error("PR write claim weakens the safe authorization policy boundary.");
  }
  return { claimId, requestedAt };
}

function freezeHunk(hunk: SelfDrivingPatchHunkInput): Readonly<SelfDrivingPatchHunkInput> {
  return Object.freeze({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: Object.freeze([...hunk.lines]) as unknown as string[],
  });
}

function proposalForValidation(
  patchById: Map<string, SelfDrivingPatchPreviewProposal>,
  validation: SelfDrivingPatchValidation["proposals"][number],
  seenPaths: Set<string>,
): { proposal: SelfDrivingPrWritePlanProposal; files: number; hunks: number; lines: number; bytes: number } {
  if (validation.reviewReady !== true || validation.status !== "passed") {
    throw new Error(`Selected validation is not review-ready: ${validation.id}`);
  }
  const patch = patchById.get(validation.patchProposalId);
  if (!patch) throw new Error(`Selected validation cannot resolve Patch Preview proposal: ${validation.patchProposalId}`);
  if (
    patch.suggestionProposalId !== validation.suggestionProposalId
    || patch.findingId !== validation.findingId
    || patch.severity !== validation.severity
  ) {
    throw new Error("Selected validation identity does not match its Patch Preview proposal.");
  }

  let hunks = 0;
  let lines = 0;
  let bytes = 0;
  const files = patch.files.map((file) => {
    if (seenPaths.has(file.path)) {
      throw new Error(`PR write execution plan v0 forbids multiple selected proposals from targeting the same path: ${file.path}`);
    }
    seenPaths.add(file.path);
    const frozenHunks = file.hunks.map((hunk) => {
      hunks += 1;
      lines += hunk.lines.length;
      for (const line of hunk.lines) bytes += textEncoder.encode(line).length;
      return freezeHunk(hunk);
    });
    return Object.freeze({
      path: file.path,
      baseBlobSha: file.baseBlobSha,
      hunks: Object.freeze(frozenHunks),
    });
  });

  return {
    proposal: Object.freeze({
      validationId: validation.id,
      patchProposalId: patch.id,
      suggestionProposalId: patch.suggestionProposalId,
      findingId: patch.findingId,
      severity: patch.severity,
      files: Object.freeze(files),
    }),
    files: files.length,
    hunks,
    lines,
    bytes,
  };
}

export function createSelfDrivingPrWriteExecutionPlan(
  suggestionPlan: SelfDrivingSuggestionPlan,
  patchPreview: SelfDrivingPatchPreview,
  validation: SelfDrivingPatchValidation,
  preflight: SelfDrivingPrPreflight,
  approval: NormalizedSelfDrivingPrWriteApproval,
  claim: SelfDrivingPrWriteClaimResult,
): SelfDrivingPrWriteExecutionPlan {
  const canonicalPreview = canonicalPatchPreview(suggestionPlan, patchPreview);
  const canonicalValidation = canonicalPatchValidation(suggestionPlan, canonicalPreview, validation);
  const canonicalPreflight = canonicalPrPreflight(canonicalValidation, preflight);
  const canonicalWriteApproval = canonicalApproval(canonicalPreflight, approval);
  const canonicalClaim = assertSuccessfulClaim(canonicalWriteApproval, claim);

  if (canonicalPreflight.selectedProposals.length > defaultSelfDrivingPrWriteExecutionPlanLimits.maxSelectedProposals) {
    throw new Error(`PR write execution plan exceeds the ${defaultSelfDrivingPrWriteExecutionPlanLimits.maxSelectedProposals}-proposal write bound.`);
  }

  const validationById = new Map(canonicalValidation.proposals.map((proposal) => [proposal.id, proposal]));
  const patchById = new Map(canonicalPreview.proposals.map((proposal) => [proposal.id, proposal]));
  const seenPaths = new Set<string>();
  let files = 0;
  let hunks = 0;
  let lines = 0;
  let bytes = 0;
  const proposals = canonicalPreflight.selectedProposals.map((selected) => {
    const sourceValidation = validationById.get(selected.validationId);
    if (!sourceValidation) throw new Error(`PR Preflight selection cannot resolve Patch Validation: ${selected.validationId}`);
    if (
      selected.patchProposalId !== sourceValidation.patchProposalId
      || selected.suggestionProposalId !== sourceValidation.suggestionProposalId
      || selected.findingId !== sourceValidation.findingId
      || selected.severity !== sourceValidation.severity
    ) {
      throw new Error("PR Preflight selection identity does not match Patch Validation.");
    }
    const normalized = proposalForValidation(patchById, sourceValidation, seenPaths);
    files += normalized.files;
    hunks += normalized.hunks;
    lines += normalized.lines;
    bytes += normalized.bytes;
    return normalized.proposal;
  });

  if (files > defaultSelfDrivingPrWriteExecutionPlanLimits.maxFiles) {
    throw new Error(`PR write execution plan exceeds the ${defaultSelfDrivingPrWriteExecutionPlanLimits.maxFiles}-file write bound.`);
  }
  if (hunks > defaultSelfDrivingPrWriteExecutionPlanLimits.maxHunks) {
    throw new Error(`PR write execution plan exceeds the ${defaultSelfDrivingPrWriteExecutionPlanLimits.maxHunks}-hunk write bound.`);
  }
  if (lines > defaultSelfDrivingPrWriteExecutionPlanLimits.maxLines) {
    throw new Error(`PR write execution plan exceeds the ${defaultSelfDrivingPrWriteExecutionPlanLimits.maxLines}-line write bound.`);
  }
  if (bytes > defaultSelfDrivingPrWriteExecutionPlanLimits.maxBytes) {
    throw new Error(`PR write execution plan exceeds the ${defaultSelfDrivingPrWriteExecutionPlanLimits.maxBytes}-byte write bound.`);
  }

  const core = {
    mode: "no-write-plan" as const,
    status: "ready-for-separate-executor" as const,
    repository: canonicalWriteApproval.binding.repository,
    baseBranch: canonicalWriteApproval.binding.baseBranch,
    baseRevision: canonicalWriteApproval.binding.baseRevision,
    headBranch: canonicalWriteApproval.binding.headBranch,
    installationRef: canonicalWriteApproval.binding.installationRef,
    preflightId: canonicalWriteApproval.binding.preflightId,
    approvalId: canonicalWriteApproval.approvalId,
    claimId: canonicalClaim.claimId,
    claimedAt: canonicalClaim.requestedAt,
    requiredPermissions: SELF_DRIVING_PR_REQUIRED_PERMISSIONS,
    liveChecks: SELF_DRIVING_PR_WRITE_LIVE_CHECKS,
    writeSequence: SELF_DRIVING_PR_PLANNED_ACTIONS,
    commitMessage: "Solve Self-Driving: apply reviewed proposals" as const,
    pullRequestTitle: "Solve Self-Driving: reviewed change proposal" as const,
    proposals: Object.freeze(proposals),
    totals: Object.freeze({ proposals: proposals.length, files, hunks, lines, bytes }),
  };
  const id = `pr_write_plan_${stableHash(JSON.stringify(core))}`;

  return Object.freeze({
    schema: SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA,
    id,
    ...core,
    policy: Object.freeze({
      sourceSuggestionRequired: true,
      sourcePatchPreviewRevalidated: true,
      sourcePatchValidationRevalidated: true,
      sourcePrPreflightRevalidated: true,
      exactApprovalRequired: true,
      successfulSingleUseClaimRequired: true,
      liveBaseRefCheckRequired: true,
      liveBranchProtectionCheckRequired: true,
      liveInstallationPermissionCheckRequired: true,
      liveHeadAbsenceCheckRequired: true,
      liveBaseBlobCheckRequired: true,
      duplicateTargetPathsAllowed: false,
      directPushToBaseAllowed: false,
      directPushToProtectedBranchAllowed: false,
      forcePushAllowed: false,
      autoMergeAllowed: false,
      retries: 0,
      githubApiAccess: false,
      credentialResolutionAccess: false,
      tokenMaterialAccepted: false,
      branchCreationAccess: false,
      commitWriteAccess: false,
      pullRequestCreationAccess: false,
      patchApplicationAccess: false,
      shellExecutionAccess: false,
      repositoryWriteAccess: false,
      mergeAccess: false,
      providerAccess: false,
      networkAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      billingMutationAccess: false,
      solveRunnerAuthority: false,
      externalSideEffects: false,
      writeExecutionStatus: "not-executed" as const,
    }),
  });
}
