import {
  createSelfDrivingPatchPreview,
  SELF_DRIVING_PATCH_PREVIEW_SCHEMA,
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
  computeSelfDrivingPrWriteApprovalBindingSha256,
  normalizeSelfDrivingPrWriteApproval,
  SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA,
  SELF_DRIVING_PR_WRITE_CLAIM_SCHEMA,
  type SelfDrivingPrWriteApprovalInput,
  type SelfDrivingPrWriteClaimResult,
} from "./selfDrivingPrWriteAuthorization";
import type { SelfDrivingSuggestionPlan } from "./selfDrivingSuggest";

export const SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA =
  "solvelang.self-driving.pr-write-execution-plan.v0" as const;

export const SELF_DRIVING_PR_WRITE_EXECUTION_LIVE_CHECKS = Object.freeze([
  "verify-exact-base-revision",
  "verify-fresh-branch-protection",
  "verify-head-branch-absent",
  "verify-base-blob-shas",
] as const);

export const defaultSelfDrivingPrWriteExecutionPlanLimits = Object.freeze({
  maxSelectedProposals: 25,
  maxFiles: 50,
  maxHunks: 256,
  maxLines: 2_500,
  maxPatchBytes: 131_072,
  maxClaimIdLength: 128,
});

type SelectedPatchFile = Readonly<{
  proposalId: string;
  validationId: string;
  suggestionProposalId: string;
  findingId: string;
  path: string;
  baseBlobSha: string;
  hunks: SelfDrivingPatchPreviewProposal["files"][number]["hunks"];
}>;

export type SelfDrivingPrWriteExecutionPlan = Readonly<{
  schema: typeof SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA;
  mode: "no-write-execution-plan";
  status: "ready-for-separate-github-executor";
  id: string;
  repository: string;
  baseBranch: string;
  baseRevision: string;
  headBranch: string;
  installationRef: string;
  approvalId: string;
  approvalBindingSha256: string;
  claimId: string;
  claimedAt: string;
  requiredPermissions: typeof SELF_DRIVING_PR_REQUIRED_PERMISSIONS;
  plannedActions: typeof SELF_DRIVING_PR_PLANNED_ACTIONS;
  requiredLiveChecks: typeof SELF_DRIVING_PR_WRITE_EXECUTION_LIVE_CHECKS;
  branchProtectionEvidence: SelfDrivingPrPreflight["branchProtection"];
  selectedProposals: SelfDrivingPrPreflight["selectedProposals"];
  files: readonly SelectedPatchFile[];
  limits: typeof defaultSelfDrivingPrWriteExecutionPlanLimits;
  totals: Readonly<{
    proposals: number;
    files: number;
    hunks: number;
    lines: number;
    patchBytes: number;
  }>;
  policy: Readonly<{
    sourceArtifactsRecreated: true;
    cryptographicApprovalBindingVerified: true;
    successfulSingleUseClaimRequired: true;
    exactBaseRevisionRequiredAtExecution: true;
    freshBranchProtectionRequiredAtExecution: true;
    headBranchMustNotExistAtExecution: true;
    baseBlobShaMatchRequiredAtExecution: true;
    directPushToBaseAllowed: false;
    directPushToProtectedBranchAllowed: false;
    forcePushAllowed: false;
    automaticMergeAllowed: false;
    credentialResolutionAccess: false;
    githubApiAccess: false;
    branchCreationAccess: false;
    commitWriteAccess: false;
    pullRequestCreationAccess: false;
    patchApplicationAccess: false;
    shellExecutionAccess: false;
    repositoryWriteAccess: false;
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

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

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function assertExactArtifact(name: string, supplied: unknown, recreated: unknown): void {
  if (canonicalJson(supplied) !== canonicalJson(recreated)) {
    throw new Error(`${name} does not match its canonical recreated artifact.`);
  }
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 support is required for PR write execution-plan binding.");
  const digest = await subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function recreatePatchPreview(
  suggestionPlan: SelfDrivingSuggestionPlan,
  supplied: SelfDrivingPatchPreview,
): SelfDrivingPatchPreview {
  if (!supplied || typeof supplied !== "object" || supplied.schema !== SELF_DRIVING_PATCH_PREVIEW_SCHEMA) {
    throw new Error("A canonical Patch Preview artifact is required.");
  }
  const recreated = createSelfDrivingPatchPreview(
    suggestionPlan,
    supplied.repositoryRevision,
    supplied.proposals.map((proposal) => ({
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
  assertExactArtifact("Patch Preview", supplied, recreated);
  return recreated;
}

function recreatePatchValidation(
  suggestionPlan: SelfDrivingSuggestionPlan,
  patchPreview: SelfDrivingPatchPreview,
  supplied: SelfDrivingPatchValidation,
): SelfDrivingPatchValidation {
  if (!supplied || typeof supplied !== "object" || supplied.schema !== SELF_DRIVING_PATCH_VALIDATION_SCHEMA) {
    throw new Error("A canonical Patch Validation artifact is required.");
  }
  const recreated = createSelfDrivingPatchValidation(
    suggestionPlan,
    patchPreview,
    supplied.proposals.map((proposal) => ({
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
  assertExactArtifact("Patch Validation", supplied, recreated);
  return recreated;
}

function recreatePrPreflight(
  patchValidation: SelfDrivingPatchValidation,
  supplied: SelfDrivingPrPreflight,
): SelfDrivingPrPreflight {
  if (!supplied || typeof supplied !== "object" || supplied.schema !== SELF_DRIVING_PR_PREFLIGHT_SCHEMA) {
    throw new Error("A canonical PR preflight artifact is required.");
  }
  const recreated = createSelfDrivingPrPreflight(patchValidation, {
    repository: supplied.repository,
    baseBranch: supplied.baseBranch,
    baseRevision: supplied.baseRevision,
    headBranch: supplied.headBranch,
    installationRef: supplied.installationRef,
    selectedValidationIds: supplied.selectedProposals.map((proposal) => proposal.validationId),
    branchProtection: {
      protectedBranches: [...supplied.branchProtection.protectedBranches],
      requiresPullRequest: supplied.branchProtection.requiresPullRequest,
      allowsForcePush: supplied.branchProtection.allowsForcePush,
      requiredApprovals: supplied.branchProtection.requiredApprovals,
      requiredChecks: [...supplied.branchProtection.requiredChecks],
      observedAt: supplied.branchProtection.observedAt,
      evidenceLocator: supplied.branchProtection.evidenceLocator,
    },
  });
  assertExactArtifact("PR preflight", supplied, recreated);
  return recreated;
}

function assertSafeClaimPolicy(claim: SelfDrivingPrWriteClaimResult): void {
  const policy = claim.policy;
  if (
    !policy
    || policy.atomicSingleUseClaimRequired !== true
    || policy.cryptographicApprovalBindingRequired !== true
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
    throw new Error("PR write execution plan requires the safe cryptographically bound claim policy.");
  }
}

function selectFiles(
  patchPreview: SelfDrivingPatchPreview,
  preflight: SelfDrivingPrPreflight,
): {
  files: readonly SelectedPatchFile[];
  totals: SelfDrivingPrWriteExecutionPlan["totals"];
} {
  if (preflight.selectedProposals.length > defaultSelfDrivingPrWriteExecutionPlanLimits.maxSelectedProposals) {
    throw new Error(`Selected proposals exceed the ${defaultSelfDrivingPrWriteExecutionPlanLimits.maxSelectedProposals}-proposal execution bound.`);
  }

  const patchById = new Map(patchPreview.proposals.map((proposal) => [proposal.id, proposal]));
  const seenPaths = new Set<string>();
  const files: SelectedPatchFile[] = [];
  let hunks = 0;
  let lines = 0;
  let patchBytes = 0;

  for (const selected of preflight.selectedProposals) {
    const patch = patchById.get(selected.patchProposalId);
    if (!patch) throw new Error(`Selected proposal cannot resolve Patch Preview ${selected.patchProposalId}.`);
    if (
      patch.suggestionProposalId !== selected.suggestionProposalId
      || patch.findingId !== selected.findingId
      || patch.severity !== selected.severity
    ) {
      throw new Error(`Selected proposal identity does not match Patch Preview ${selected.patchProposalId}.`);
    }

    for (const file of patch.files) {
      if (seenPaths.has(file.path)) {
        throw new Error(`Selected proposals overlap on file path ${file.path}.`);
      }
      seenPaths.add(file.path);
      const clonedHunks = file.hunks.map((hunk) => ({
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: [...hunk.lines],
      }));
      for (const hunk of clonedHunks) {
        hunks += 1;
        lines += hunk.lines.length;
        for (const line of hunk.lines) patchBytes += textEncoder.encode(line).length;
      }
      files.push(Object.freeze({
        proposalId: patch.id,
        validationId: selected.validationId,
        suggestionProposalId: selected.suggestionProposalId,
        findingId: selected.findingId,
        path: file.path,
        baseBlobSha: file.baseBlobSha,
        hunks: Object.freeze(clonedHunks.map((hunk) => Object.freeze({
          ...hunk,
          lines: Object.freeze([...hunk.lines]) as unknown as string[],
        }))) as unknown as SelfDrivingPatchPreviewProposal["files"][number]["hunks"],
      }));
    }
  }

  files.sort((left, right) => compareText(left.path, right.path));
  if (files.length > defaultSelfDrivingPrWriteExecutionPlanLimits.maxFiles) {
    throw new Error(`Execution plan exceeds the ${defaultSelfDrivingPrWriteExecutionPlanLimits.maxFiles}-file bound.`);
  }
  if (hunks > defaultSelfDrivingPrWriteExecutionPlanLimits.maxHunks) {
    throw new Error(`Execution plan exceeds the ${defaultSelfDrivingPrWriteExecutionPlanLimits.maxHunks}-hunk bound.`);
  }
  if (lines > defaultSelfDrivingPrWriteExecutionPlanLimits.maxLines) {
    throw new Error(`Execution plan exceeds the ${defaultSelfDrivingPrWriteExecutionPlanLimits.maxLines}-line bound.`);
  }
  if (patchBytes > defaultSelfDrivingPrWriteExecutionPlanLimits.maxPatchBytes) {
    throw new Error(`Execution plan exceeds the ${defaultSelfDrivingPrWriteExecutionPlanLimits.maxPatchBytes}-byte patch bound.`);
  }

  return {
    files: Object.freeze(files),
    totals: Object.freeze({
      proposals: preflight.selectedProposals.length,
      files: files.length,
      hunks,
      lines,
      patchBytes,
    }),
  };
}

export async function createSelfDrivingPrWriteExecutionPlan(
  suggestionPlan: SelfDrivingSuggestionPlan,
  patchPreview: SelfDrivingPatchPreview,
  patchValidation: SelfDrivingPatchValidation,
  preflight: SelfDrivingPrPreflight,
  approvalInput: SelfDrivingPrWriteApprovalInput,
  claim: SelfDrivingPrWriteClaimResult,
): Promise<SelfDrivingPrWriteExecutionPlan> {
  const canonicalPreview = recreatePatchPreview(suggestionPlan, patchPreview);
  const canonicalValidation = recreatePatchValidation(suggestionPlan, canonicalPreview, patchValidation);
  const canonicalPreflight = recreatePrPreflight(canonicalValidation, preflight);
  const approval = normalizeSelfDrivingPrWriteApproval(canonicalPreflight, approvalInput);
  const approvalBindingSha256 = await computeSelfDrivingPrWriteApprovalBindingSha256(approval);

  if (!claim || typeof claim !== "object" || claim.schema !== SELF_DRIVING_PR_WRITE_CLAIM_SCHEMA) {
    throw new Error("A canonical PR write claim artifact is required.");
  }
  if (claim.status !== "claimed") throw new Error("PR write execution plan requires a successful claimed authorization.");
  assertSafeClaimPolicy(claim);
  const claimId = normalizeText(claim.claimId ?? "", "claimId", defaultSelfDrivingPrWriteExecutionPlanLimits.maxClaimIdLength);
  if (claim.approvalId !== approval.approvalId) throw new Error("Claim approvalId does not match the normalized approval.");
  if (claim.preflightId !== canonicalPreflight.id) throw new Error("Claim preflightId does not match the canonical PR preflight.");
  if (claim.approvalBindingSha256 !== approvalBindingSha256) {
    throw new Error("Claim SHA-256 approval binding does not match the normalized approval.");
  }
  if (!/^[0-9a-f]{64}$/.test(claim.approvalBindingSha256)) {
    throw new Error("Claim SHA-256 approval binding must be canonical lowercase hex.");
  }
  if (claim.requestedAt < approval.notBefore || claim.requestedAt >= approval.expiresAt) {
    throw new Error("Claim timestamp is outside the normalized approval window.");
  }

  const selection = selectFiles(canonicalPreview, canonicalPreflight);
  const canonicalPlan = {
    repository: canonicalPreflight.repository,
    baseBranch: canonicalPreflight.baseBranch,
    baseRevision: canonicalPreflight.baseRevision,
    headBranch: canonicalPreflight.headBranch,
    installationRef: canonicalPreflight.installationRef,
    approvalId: approval.approvalId,
    approvalBindingSha256,
    claimId,
    claimedAt: claim.requestedAt,
    requiredPermissions: SELF_DRIVING_PR_REQUIRED_PERMISSIONS,
    plannedActions: SELF_DRIVING_PR_PLANNED_ACTIONS,
    requiredLiveChecks: SELF_DRIVING_PR_WRITE_EXECUTION_LIVE_CHECKS,
    branchProtectionEvidence: canonicalPreflight.branchProtection,
    selectedProposals: canonicalPreflight.selectedProposals,
    files: selection.files,
    limits: defaultSelfDrivingPrWriteExecutionPlanLimits,
    totals: selection.totals,
  };
  const id = `pr_write_plan_${await sha256Hex(canonicalJson(canonicalPlan))}`;

  return Object.freeze({
    schema: SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA,
    mode: "no-write-execution-plan" as const,
    status: "ready-for-separate-github-executor" as const,
    id,
    ...canonicalPlan,
    policy: Object.freeze({
      sourceArtifactsRecreated: true as const,
      cryptographicApprovalBindingVerified: true as const,
      successfulSingleUseClaimRequired: true as const,
      exactBaseRevisionRequiredAtExecution: true as const,
      freshBranchProtectionRequiredAtExecution: true as const,
      headBranchMustNotExistAtExecution: true as const,
      baseBlobShaMatchRequiredAtExecution: true as const,
      directPushToBaseAllowed: false as const,
      directPushToProtectedBranchAllowed: false as const,
      forcePushAllowed: false as const,
      automaticMergeAllowed: false as const,
      credentialResolutionAccess: false as const,
      githubApiAccess: false as const,
      branchCreationAccess: false as const,
      commitWriteAccess: false as const,
      pullRequestCreationAccess: false as const,
      patchApplicationAccess: false as const,
      shellExecutionAccess: false as const,
      repositoryWriteAccess: false as const,
      providerAccess: false as const,
      networkAccess: false as const,
      rolloutMutationAccess: false as const,
      productionMutationAccess: false as const,
      billingMutationAccess: false as const,
      solveRunnerAuthority: false as const,
      externalSideEffects: false as const,
      writeExecutionStatus: "not-executed" as const,
    }),
  });
}
