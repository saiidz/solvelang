import type { RepositorySeverity } from "./inventory";
import {
  SELF_DRIVING_PATCH_VALIDATION_SCHEMA,
  type PatchProposalValidation,
  type SelfDrivingPatchValidation,
} from "./selfDrivingPatchValidation";

export const SELF_DRIVING_PR_PREFLIGHT_SCHEMA = "solvelang.self-driving.pr-preflight.v0" as const;

export const SELF_DRIVING_PR_REQUIRED_PERMISSIONS = Object.freeze({
  metadata: "read",
  contents: "write",
  pullRequests: "write",
} as const);

export const SELF_DRIVING_PR_PLANNED_ACTIONS = Object.freeze([
  "create-branch",
  "create-commit",
  "open-pr",
] as const);

export type SelfDrivingBranchProtectionInput = {
  protectedBranches: string[];
  requiresPullRequest: boolean;
  allowsForcePush: boolean;
  requiredApprovals: number;
  requiredChecks: string[];
  observedAt: string;
  evidenceLocator: string;
};

export type SelfDrivingPrPreflightInput = {
  repository: string;
  baseBranch: string;
  baseRevision: string;
  headBranch: string;
  installationRef: string;
  selectedValidationIds: string[];
  branchProtection: SelfDrivingBranchProtectionInput;
};

export type SelfDrivingPrPreflight = {
  schema: typeof SELF_DRIVING_PR_PREFLIGHT_SCHEMA;
  mode: "authorization-preflight";
  status: "ready-for-separate-write-authorization";
  id: string;
  repository: string;
  baseBranch: string;
  baseRevision: string;
  headBranch: string;
  installationRef: string;
  requiredPermissions: typeof SELF_DRIVING_PR_REQUIRED_PERMISSIONS;
  plannedActions: typeof SELF_DRIVING_PR_PLANNED_ACTIONS;
  branchProtection: {
    protectedBranches: string[];
    requiresPullRequest: true;
    allowsForcePush: false;
    requiredApprovals: number;
    requiredChecks: string[];
    observedAt: string;
    evidenceLocator: string;
  };
  selectedProposals: Array<{
    validationId: string;
    patchProposalId: string;
    suggestionProposalId: string;
    findingId: string;
    severity: RepositorySeverity;
  }>;
  policy: {
    sourceValidationRequired: true;
    sourceValidationComplete: true;
    allSelectedProposalsReviewReady: true;
    directPushToBaseAllowed: false;
    directPushToProtectedBranchAllowed: false;
    forcePushAllowed: false;
    tokenMaterialAccepted: false;
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
    writeAuthorizationGranted: false;
  };
};

export const defaultSelfDrivingPrPreflightLimits = Object.freeze({
  maxRepositoryLength: 201,
  maxBranchLength: 128,
  maxInstallationRefLength: 256,
  maxSelectedProposals: 100,
  maxProtectedBranches: 32,
  maxRequiredChecks: 32,
  maxRequiredApprovals: 10,
  maxEvidenceLocatorLength: 512,
  maxCheckNameLength: 128,
});

const severityRank: Record<RepositorySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

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

function normalizeSha(value: string, name: string): string {
  const normalized = normalizeText(value, name, 64).toLowerCase();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(normalized)) {
    throw new Error(`${name} must be an exact 40- or 64-hex revision.`);
  }
  return normalized;
}

function normalizeRepository(value: string): string {
  const normalized = normalizeText(value, "repository", defaultSelfDrivingPrPreflightLimits.maxRepositoryLength);
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(normalized)) {
    throw new Error("repository must use exact owner/name syntax.");
  }
  const [owner, name] = normalized.split("/");
  if (owner === "." || owner === ".." || name === "." || name === "..") {
    throw new Error("repository contains an unsafe owner or name.");
  }
  return normalized;
}

function normalizeBranch(value: string, name: string): string {
  const normalized = normalizeText(value, name, defaultSelfDrivingPrPreflightLimits.maxBranchLength);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(normalized)) {
    throw new Error(`${name} contains unsupported branch characters.`);
  }
  if (
    normalized.startsWith("refs/")
    || normalized.startsWith("/")
    || normalized.endsWith("/")
    || normalized.endsWith(".")
    || normalized.includes("..")
    || normalized.includes("//")
    || normalized.includes("@{")
  ) {
    throw new Error(`${name} is not a canonical safe branch name.`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment.endsWith(".lock"))) {
    throw new Error(`${name} contains an unsafe branch segment.`);
  }
  return normalized;
}

function normalizeInstallationRef(value: string): string {
  const normalized = normalizeText(value, "installationRef", defaultSelfDrivingPrPreflightLimits.maxInstallationRefLength);
  if (/^https?:\/\//i.test(normalized)) throw new Error("installationRef must be an opaque reference, not a URL.");
  if (!/^[A-Za-z][A-Za-z0-9._:/-]{2,255}$/.test(normalized)) {
    throw new Error("installationRef must use bounded opaque-reference syntax.");
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

function normalizeUniqueTextList(
  values: string[],
  name: string,
  maxItems: number,
  maxItemLength: number,
  itemNormalizer: (value: string, name: string) => string = (value, itemName) => normalizeText(value, itemName, maxItemLength),
): string[] {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${name} must be a non-empty array.`);
  if (values.length > maxItems) throw new Error(`${name} exceeds the ${maxItems}-item safety bound.`);
  const normalized = values.map((value, index) => itemNormalizer(value, `${name}[${index}]`)).sort(compareText);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index] === normalized[index - 1]) throw new Error(`${name} contains duplicate values.`);
  }
  return normalized;
}

function assertSafeValidationSource(source: SelfDrivingPatchValidation): void {
  if (!source || typeof source !== "object") throw new Error("A canonical Patch Validation artifact is required.");
  if (source.schema !== SELF_DRIVING_PATCH_VALIDATION_SCHEMA || source.mode !== "review-only") {
    throw new Error("PR preflight requires the canonical review-only Patch Validation contract.");
  }
  if (source.execution.status !== "complete" || source.execution.partialReasons.length !== 0) {
    throw new Error("PR preflight requires complete Patch Validation evidence.");
  }
  const policy = source.policy;
  if (
    policy.sourceMode !== "suggest"
    || policy.evidenceSource !== "caller-supplied"
    || policy.validationExecutionAccess !== false
    || policy.patchApplicationAccess !== false
    || policy.shellExecutionAccess !== false
    || policy.githubWriteAccess !== false
    || policy.repositoryWriteAccess !== false
    || policy.providerAccess !== false
    || policy.networkAccess !== false
    || policy.credentialAccess !== false
    || policy.rolloutMutationAccess !== false
    || policy.productionMutationAccess !== false
    || policy.billingMutationAccess !== false
    || policy.solveRunnerAuthority !== false
    || policy.externalSideEffects !== false
  ) {
    throw new Error("PR preflight requires the safe Patch Validation policy boundary.");
  }
  if (!Array.isArray(source.proposals) || source.proposals.length !== source.execution.validatedProposals) {
    throw new Error("PR preflight requires internally consistent Patch Validation proposals.");
  }
}

function normalizeBranchProtection(
  input: SelfDrivingBranchProtectionInput,
  baseBranch: string,
  headBranch: string,
): SelfDrivingPrPreflight["branchProtection"] {
  if (!input || typeof input !== "object") throw new Error("branchProtection evidence is required.");
  if (input.requiresPullRequest !== true) throw new Error("Base branch protection must require pull requests.");
  if (input.allowsForcePush !== false) throw new Error("Base branch protection must disable force pushes.");
  if (!Number.isSafeInteger(input.requiredApprovals) || input.requiredApprovals < 1 || input.requiredApprovals > defaultSelfDrivingPrPreflightLimits.maxRequiredApprovals) {
    throw new Error(`requiredApprovals must be between 1 and ${defaultSelfDrivingPrPreflightLimits.maxRequiredApprovals}.`);
  }
  const protectedBranches = normalizeUniqueTextList(
    input.protectedBranches,
    "branchProtection.protectedBranches",
    defaultSelfDrivingPrPreflightLimits.maxProtectedBranches,
    defaultSelfDrivingPrPreflightLimits.maxBranchLength,
    normalizeBranch,
  );
  if (!protectedBranches.includes(baseBranch)) throw new Error("Base branch must appear in the protected-branch evidence set.");
  if (protectedBranches.includes(headBranch)) throw new Error("Proposed head branch may not target a protected branch.");
  const requiredChecks = normalizeUniqueTextList(
    input.requiredChecks,
    "branchProtection.requiredChecks",
    defaultSelfDrivingPrPreflightLimits.maxRequiredChecks,
    defaultSelfDrivingPrPreflightLimits.maxCheckNameLength,
  );
  return {
    protectedBranches,
    requiresPullRequest: true,
    allowsForcePush: false,
    requiredApprovals: input.requiredApprovals,
    requiredChecks,
    observedAt: normalizeUtcTimestamp(input.observedAt, "branchProtection.observedAt"),
    evidenceLocator: normalizeText(
      input.evidenceLocator,
      "branchProtection.evidenceLocator",
      defaultSelfDrivingPrPreflightLimits.maxEvidenceLocatorLength,
    ),
  };
}

function selectValidatedProposals(
  source: SelfDrivingPatchValidation,
  ids: string[],
): SelfDrivingPrPreflight["selectedProposals"] {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error("selectedValidationIds must select at least one validated proposal.");
  if (ids.length > defaultSelfDrivingPrPreflightLimits.maxSelectedProposals) {
    throw new Error(`selectedValidationIds exceeds the ${defaultSelfDrivingPrPreflightLimits.maxSelectedProposals}-proposal safety bound.`);
  }
  const normalizedIds = ids.map((id, index) => normalizeText(id, `selectedValidationIds[${index}]`, 128));
  const seen = new Set<string>();
  const byId = new Map(source.proposals.map((proposal) => [proposal.id, proposal]));
  const selected: PatchProposalValidation[] = [];
  for (const id of normalizedIds) {
    if (seen.has(id)) throw new Error(`selectedValidationIds contains duplicate proposal ${id}.`);
    seen.add(id);
    const proposal = byId.get(id);
    if (!proposal) throw new Error(`selectedValidationIds references an unknown Patch Validation proposal: ${id}`);
    if (proposal.status !== "passed" || proposal.reviewReady !== true) {
      throw new Error(`Selected Patch Validation proposal is not review-ready: ${id}`);
    }
    selected.push(proposal);
  }
  return selected.sort((left, right) =>
    severityRank[left.severity] - severityRank[right.severity]
    || compareText(left.findingId, right.findingId)
    || compareText(left.id, right.id))
    .map((proposal) => ({
      validationId: proposal.id,
      patchProposalId: proposal.patchProposalId,
      suggestionProposalId: proposal.suggestionProposalId,
      findingId: proposal.findingId,
      severity: proposal.severity,
    }));
}

export function createSelfDrivingPrPreflight(
  source: SelfDrivingPatchValidation,
  input: SelfDrivingPrPreflightInput,
): SelfDrivingPrPreflight {
  assertSafeValidationSource(source);
  if (!input || typeof input !== "object") throw new Error("PR preflight input is required.");
  const repository = normalizeRepository(input.repository);
  const baseBranch = normalizeBranch(input.baseBranch, "baseBranch");
  const baseRevision = normalizeSha(input.baseRevision, "baseRevision");
  if (baseRevision !== source.repositoryRevision.toLowerCase()) {
    throw new Error("baseRevision must exactly match the validated Patch Preview repository revision.");
  }
  const headBranch = normalizeBranch(input.headBranch, "headBranch");
  if (headBranch === baseBranch) throw new Error("Proposed head branch must differ from the protected base branch.");
  const installationRef = normalizeInstallationRef(input.installationRef);
  const branchProtection = normalizeBranchProtection(input.branchProtection, baseBranch, headBranch);
  const selectedProposals = selectValidatedProposals(source, input.selectedValidationIds);

  const canonical = JSON.stringify({
    repository,
    baseBranch,
    baseRevision,
    headBranch,
    installationRef,
    branchProtection,
    selectedProposals,
    requiredPermissions: SELF_DRIVING_PR_REQUIRED_PERMISSIONS,
    plannedActions: SELF_DRIVING_PR_PLANNED_ACTIONS,
  });

  return {
    schema: SELF_DRIVING_PR_PREFLIGHT_SCHEMA,
    mode: "authorization-preflight",
    status: "ready-for-separate-write-authorization",
    id: `pr_preflight_${stableHash(canonical)}`,
    repository,
    baseBranch,
    baseRevision,
    headBranch,
    installationRef,
    requiredPermissions: SELF_DRIVING_PR_REQUIRED_PERMISSIONS,
    plannedActions: SELF_DRIVING_PR_PLANNED_ACTIONS,
    branchProtection,
    selectedProposals,
    policy: {
      sourceValidationRequired: true,
      sourceValidationComplete: true,
      allSelectedProposalsReviewReady: true,
      directPushToBaseAllowed: false,
      directPushToProtectedBranchAllowed: false,
      forcePushAllowed: false,
      tokenMaterialAccepted: false,
      credentialResolutionAccess: false,
      githubApiAccess: false,
      branchCreationAccess: false,
      commitWriteAccess: false,
      pullRequestCreationAccess: false,
      patchApplicationAccess: false,
      shellExecutionAccess: false,
      repositoryWriteAccess: false,
      providerAccess: false,
      networkAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      billingMutationAccess: false,
      solveRunnerAuthority: false,
      externalSideEffects: false,
      writeExecutionStatus: "not-executed",
      writeAuthorizationGranted: false,
    },
  };
}
