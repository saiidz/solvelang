import {
  SELF_DRIVING_PR_PLANNED_ACTIONS,
  SELF_DRIVING_PR_PREFLIGHT_SCHEMA,
  SELF_DRIVING_PR_REQUIRED_PERMISSIONS,
  type SelfDrivingPrPreflight,
} from "./selfDrivingPrPreflight";

export const SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA = "solvelang.self-driving.pr-write-approval.v0" as const;
export const SELF_DRIVING_PR_WRITE_CLAIM_SCHEMA = "solvelang.self-driving.pr-write-claim.v0" as const;

export type SelfDrivingPrWriteApprovalInput = {
  schema: typeof SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA;
  state: "approved";
  approvalId: string;
  preflightId: string;
  repository: string;
  baseBranch: string;
  baseRevision: string;
  headBranch: string;
  installationRef: string;
  operator: string;
  runtime: string;
  notBefore: string;
  expiresAt: string;
};

export type SelfDrivingPrWriteBinding = Readonly<{
  preflightId: string;
  repository: string;
  baseBranch: string;
  baseRevision: string;
  headBranch: string;
  installationRef: string;
  requiredPermissions: typeof SELF_DRIVING_PR_REQUIRED_PERMISSIONS;
  plannedActions: typeof SELF_DRIVING_PR_PLANNED_ACTIONS;
  branchProtection: Readonly<{
    protectedBranches: readonly string[];
    requiresPullRequest: true;
    allowsForcePush: false;
    requiredApprovals: number;
    requiredChecks: readonly string[];
    observedAt: string;
    evidenceLocator: string;
  }>;
  selectedProposals: readonly Readonly<{
    validationId: string;
    patchProposalId: string;
    suggestionProposalId: string;
    findingId: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
  }>[];
}>;

export type NormalizedSelfDrivingPrWriteApproval = Readonly<{
  schema: typeof SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA;
  state: "approved";
  approvalId: string;
  operator: string;
  runtime: string;
  notBefore: string;
  expiresAt: string;
  binding: SelfDrivingPrWriteBinding;
}>;

export type SelfDrivingPrWriteAtomicClaimRequest = Readonly<{
  schema: typeof SELF_DRIVING_PR_WRITE_CLAIM_SCHEMA;
  expectedState: "approved";
  approvalId: string;
  approvalBindingSha256: string;
  requestedAt: string;
  binding: NormalizedSelfDrivingPrWriteApproval;
}>;

export const SELF_DRIVING_PR_WRITE_CLAIM_REJECTION_REASONS = [
  "not-approved",
  "already-claimed",
  "already-consumed",
  "expired",
  "binding-mismatch",
  "store-rejected",
] as const;

export type SelfDrivingPrWriteClaimRejectionReason =
  (typeof SELF_DRIVING_PR_WRITE_CLAIM_REJECTION_REASONS)[number];

export type SelfDrivingPrWriteAtomicClaimDependencyResult =
  | { status: "claimed"; claimId: string }
  | { status: "rejected"; reason: SelfDrivingPrWriteClaimRejectionReason };

export type SelfDrivingPrWriteAtomicClaimer = (
  request: SelfDrivingPrWriteAtomicClaimRequest,
) => Promise<SelfDrivingPrWriteAtomicClaimDependencyResult>;

export type SelfDrivingPrWriteClaimResult = {
  schema: typeof SELF_DRIVING_PR_WRITE_CLAIM_SCHEMA;
  status: "claimed" | "rejected";
  approvalId: string;
  approvalBindingSha256: string;
  preflightId: string;
  requestedAt: string;
  claimId?: string;
  rejectionReason?: SelfDrivingPrWriteClaimRejectionReason | "claimer-failure" | "invalid-claim-result";
  policy: {
    atomicSingleUseClaimRequired: true;
    cryptographicApprovalBindingRequired: true;
    freshBranchProtectionEvidenceRequired: true;
    writeAuthorizationClaimMutationAttempted: true;
    retries: 0;
    automaticRearm: false;
    githubApiAccess: false;
    credentialResolutionAccess: false;
    tokenMaterialAccepted: false;
    branchCreationAccess: false;
    commitWriteAccess: false;
    pullRequestCreationAccess: false;
    patchApplicationAccess: false;
    shellExecutionAccess: false;
    directPushToBaseAllowed: false;
    directPushToProtectedBranchAllowed: false;
    forcePushAllowed: false;
    repositoryWriteAccess: false;
    mergeAccess: false;
    providerAccess: false;
    networkAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    billingMutationAccess: false;
    solveRunnerAuthority: false;
    credentialMaterialReturned: false;
    writeExecutionStatus: "not-executed";
  };
};

export const defaultSelfDrivingPrWriteAuthorizationLimits = Object.freeze({
  maxApprovalIdLength: 128,
  maxIdentifierLength: 256,
  maxEvidenceLocatorLength: 512,
  maxSelectedProposals: 100,
  maxProtectedBranches: 32,
  maxRequiredChecks: 32,
  maxAuthorizationWindowMs: 15 * 60 * 1000,
  maxBranchProtectionEvidenceAgeMs: 5 * 60 * 1000,
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

const severities = ["critical", "high", "medium", "low", "info"] as const;
const severityRank: Record<(typeof severities)[number], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};
const textEncoder = new TextEncoder();

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
  const normalized = normalizeText(value, "repository", 201);
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
  const normalized = normalizeText(value, name, 128);
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
  if (normalized.split("/").some((segment) => segment === "." || segment === ".." || segment.endsWith(".lock"))) {
    throw new Error(`${name} contains an unsafe branch segment.`);
  }
  return normalized;
}

function normalizeInstallationRef(value: string): string {
  const normalized = normalizeText(value, "installationRef", 256);
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

function normalizeSortedUniqueList(
  values: readonly string[],
  name: string,
  maxItems: number,
  maxItemLength: number,
  normalizer: (value: string, name: string) => string = (value, itemName) => normalizeText(value, itemName, maxItemLength),
): string[] {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${name} must be a non-empty array.`);
  if (values.length > maxItems) throw new Error(`${name} exceeds the ${maxItems}-item safety bound.`);
  const normalized = values.map((value, index) => normalizer(value, `${name}[${index}]`));
  const sorted = [...normalized].sort(compareText);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) throw new Error(`${name} contains duplicate values.`);
  }
  if (normalized.some((value, index) => value !== sorted[index])) {
    throw new Error(`${name} must already use canonical sorted order.`);
  }
  return sorted;
}

function assertExactPermissions(preflight: SelfDrivingPrPreflight): void {
  const permissions = preflight.requiredPermissions;
  if (
    !permissions
    || permissions.metadata !== SELF_DRIVING_PR_REQUIRED_PERMISSIONS.metadata
    || permissions.contents !== SELF_DRIVING_PR_REQUIRED_PERMISSIONS.contents
    || permissions.pullRequests !== SELF_DRIVING_PR_REQUIRED_PERMISSIONS.pullRequests
    || Object.keys(permissions).length !== 3
  ) {
    throw new Error("PR write authorization requires the exact least-privilege preflight permissions.");
  }
  if (
    !Array.isArray(preflight.plannedActions)
    || preflight.plannedActions.length !== SELF_DRIVING_PR_PLANNED_ACTIONS.length
    || preflight.plannedActions.some((action, index) => action !== SELF_DRIVING_PR_PLANNED_ACTIONS[index])
  ) {
    throw new Error("PR write authorization requires the exact preflight action sequence.");
  }
}

function assertSafePreflightPolicy(preflight: SelfDrivingPrPreflight): void {
  const policy = preflight.policy;
  if (
    !policy
    || policy.sourceValidationRequired !== true
    || policy.sourceValidationComplete !== true
    || policy.allSelectedProposalsReviewReady !== true
    || policy.directPushToBaseAllowed !== false
    || policy.directPushToProtectedBranchAllowed !== false
    || policy.forcePushAllowed !== false
    || policy.tokenMaterialAccepted !== false
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
    || policy.writeAuthorizationGranted !== false
  ) {
    throw new Error("PR write authorization requires the safe no-write preflight policy boundary.");
  }
}

function normalizePreflightBinding(preflight: SelfDrivingPrPreflight): SelfDrivingPrWriteBinding {
  if (!preflight || typeof preflight !== "object") throw new Error("A canonical PR preflight artifact is required.");
  if (
    preflight.schema !== SELF_DRIVING_PR_PREFLIGHT_SCHEMA
    || preflight.mode !== "authorization-preflight"
    || preflight.status !== "ready-for-separate-write-authorization"
  ) {
    throw new Error("PR write authorization requires the canonical authorization-preflight contract.");
  }
  assertExactPermissions(preflight);
  assertSafePreflightPolicy(preflight);

  const repository = normalizeRepository(preflight.repository);
  const baseBranch = normalizeBranch(preflight.baseBranch, "preflight.baseBranch");
  const baseRevision = normalizeSha(preflight.baseRevision, "preflight.baseRevision");
  const headBranch = normalizeBranch(preflight.headBranch, "preflight.headBranch");
  if (headBranch === baseBranch) throw new Error("PR write authorization forbids direct writes to the base branch.");
  const installationRef = normalizeInstallationRef(preflight.installationRef);

  const branchProtection = preflight.branchProtection;
  if (!branchProtection || typeof branchProtection !== "object") throw new Error("Canonical branch-protection evidence is required.");
  if (branchProtection.requiresPullRequest !== true || branchProtection.allowsForcePush !== false) {
    throw new Error("PR write authorization requires pull-request-only, no-force-push branch protection.");
  }
  if (!Number.isSafeInteger(branchProtection.requiredApprovals) || branchProtection.requiredApprovals < 1 || branchProtection.requiredApprovals > 10) {
    throw new Error("PR write authorization requires at least one bounded approval.");
  }
  const protectedBranches = normalizeSortedUniqueList(
    branchProtection.protectedBranches,
    "preflight.branchProtection.protectedBranches",
    defaultSelfDrivingPrWriteAuthorizationLimits.maxProtectedBranches,
    128,
    normalizeBranch,
  );
  if (!protectedBranches.includes(baseBranch)) throw new Error("Base branch must remain protected at write authorization.");
  if (protectedBranches.includes(headBranch)) throw new Error("Head branch may not be a protected branch at write authorization.");
  const requiredChecks = normalizeSortedUniqueList(
    branchProtection.requiredChecks,
    "preflight.branchProtection.requiredChecks",
    defaultSelfDrivingPrWriteAuthorizationLimits.maxRequiredChecks,
    128,
  );
  const observedAt = normalizeUtcTimestamp(branchProtection.observedAt, "preflight.branchProtection.observedAt");
  const evidenceLocator = normalizeText(
    branchProtection.evidenceLocator,
    "preflight.branchProtection.evidenceLocator",
    defaultSelfDrivingPrWriteAuthorizationLimits.maxEvidenceLocatorLength,
  );

  if (!Array.isArray(preflight.selectedProposals) || preflight.selectedProposals.length === 0) {
    throw new Error("PR write authorization requires at least one selected review-ready proposal.");
  }
  if (preflight.selectedProposals.length > defaultSelfDrivingPrWriteAuthorizationLimits.maxSelectedProposals) {
    throw new Error(`selectedProposals exceeds the ${defaultSelfDrivingPrWriteAuthorizationLimits.maxSelectedProposals}-proposal safety bound.`);
  }
  const seenValidationIds = new Set<string>();
  const selectedProposals = preflight.selectedProposals.map((proposal, index) => {
    if (!proposal || typeof proposal !== "object") throw new Error(`selectedProposals[${index}] must be an object.`);
    const validationId = normalizeText(proposal.validationId, `selectedProposals[${index}].validationId`, 128);
    if (seenValidationIds.has(validationId)) throw new Error("selectedProposals contains duplicate validation IDs.");
    seenValidationIds.add(validationId);
    const severity = proposal.severity;
    if (!severities.includes(severity)) throw new Error(`selectedProposals[${index}].severity is invalid.`);
    return Object.freeze({
      validationId,
      patchProposalId: normalizeText(proposal.patchProposalId, `selectedProposals[${index}].patchProposalId`, 128),
      suggestionProposalId: normalizeText(proposal.suggestionProposalId, `selectedProposals[${index}].suggestionProposalId`, 128),
      findingId: normalizeText(proposal.findingId, `selectedProposals[${index}].findingId`, 128),
      severity,
    });
  });
  const canonicalSelectedProposals = [...selectedProposals].sort((left, right) =>
    severityRank[left.severity] - severityRank[right.severity]
    || compareText(left.findingId, right.findingId)
    || compareText(left.validationId, right.validationId));
  if (selectedProposals.some((proposal, index) => proposal.validationId !== canonicalSelectedProposals[index].validationId)) {
    throw new Error("selectedProposals must use canonical PR preflight ordering.");
  }

  const normalizedBranchProtection = Object.freeze({
    protectedBranches: Object.freeze([...protectedBranches]),
    requiresPullRequest: true as const,
    allowsForcePush: false as const,
    requiredApprovals: branchProtection.requiredApprovals,
    requiredChecks: Object.freeze([...requiredChecks]),
    observedAt,
    evidenceLocator,
  });
  const normalizedSelectedProposals = Object.freeze([...selectedProposals]);

  const canonical = JSON.stringify({
    repository,
    baseBranch,
    baseRevision,
    headBranch,
    installationRef,
    branchProtection: {
      protectedBranches,
      requiresPullRequest: true,
      allowsForcePush: false,
      requiredApprovals: branchProtection.requiredApprovals,
      requiredChecks,
      observedAt,
      evidenceLocator,
    },
    selectedProposals: selectedProposals.map((proposal) => ({ ...proposal })),
    requiredPermissions: SELF_DRIVING_PR_REQUIRED_PERMISSIONS,
    plannedActions: SELF_DRIVING_PR_PLANNED_ACTIONS,
  });
  const expectedPreflightId = `pr_preflight_${stableHash(canonical)}`;
  if (preflight.id !== expectedPreflightId) {
    throw new Error("PR preflight identity does not match its canonical write binding.");
  }

  return Object.freeze({
    preflightId: expectedPreflightId,
    repository,
    baseBranch,
    baseRevision,
    headBranch,
    installationRef,
    requiredPermissions: SELF_DRIVING_PR_REQUIRED_PERMISSIONS,
    plannedActions: SELF_DRIVING_PR_PLANNED_ACTIONS,
    branchProtection: normalizedBranchProtection,
    selectedProposals: normalizedSelectedProposals,
  });
}

function normalizeClaimDependencyResult(
  value: SelfDrivingPrWriteAtomicClaimDependencyResult,
): SelfDrivingPrWriteAtomicClaimDependencyResult | null {
  if (!value || typeof value !== "object") return null;
  if (value.status === "claimed") {
    try {
      return { status: "claimed", claimId: normalizeText(value.claimId, "claimId", 128) };
    } catch {
      return null;
    }
  }
  if (
    value.status === "rejected"
    && SELF_DRIVING_PR_WRITE_CLAIM_REJECTION_REASONS.includes(value.reason as SelfDrivingPrWriteClaimRejectionReason)
  ) {
    return { status: "rejected", reason: value.reason as SelfDrivingPrWriteClaimRejectionReason };
  }
  return null;
}

export function normalizeSelfDrivingPrWriteApproval(
  preflight: SelfDrivingPrPreflight,
  input: SelfDrivingPrWriteApprovalInput,
): NormalizedSelfDrivingPrWriteApproval {
  const binding = normalizePreflightBinding(preflight);
  if (!input || typeof input !== "object") throw new Error("PR write approval is required.");
  if (input.schema !== SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA) throw new Error("PR write approval schema is not supported.");
  if (input.state !== "approved") throw new Error("PR write approval must be in approved state before claim.");

  const approvalId = normalizeText(input.approvalId, "approvalId", defaultSelfDrivingPrWriteAuthorizationLimits.maxApprovalIdLength);
  const preflightId = normalizeText(input.preflightId, "preflightId", 128);
  if (preflightId !== binding.preflightId) throw new Error("preflightId must exactly match the canonical PR preflight artifact.");
  if (normalizeRepository(input.repository) !== binding.repository) throw new Error("repository must exactly match the PR preflight binding.");
  if (normalizeBranch(input.baseBranch, "baseBranch") !== binding.baseBranch) throw new Error("baseBranch must exactly match the PR preflight binding.");
  if (normalizeSha(input.baseRevision, "baseRevision") !== binding.baseRevision) throw new Error("baseRevision must exactly match the PR preflight binding.");
  if (normalizeBranch(input.headBranch, "headBranch") !== binding.headBranch) throw new Error("headBranch must exactly match the PR preflight binding.");
  if (normalizeInstallationRef(input.installationRef) !== binding.installationRef) throw new Error("installationRef must exactly match the PR preflight binding.");

  const operator = normalizeText(input.operator, "operator", defaultSelfDrivingPrWriteAuthorizationLimits.maxIdentifierLength);
  const runtime = normalizeText(input.runtime, "runtime", defaultSelfDrivingPrWriteAuthorizationLimits.maxIdentifierLength);
  const notBefore = normalizeUtcTimestamp(input.notBefore, "notBefore");
  const expiresAt = normalizeUtcTimestamp(input.expiresAt, "expiresAt");
  const lifetime = Date.parse(expiresAt) - Date.parse(notBefore);
  if (lifetime <= 0) throw new Error("expiresAt must be after notBefore.");
  if (lifetime > defaultSelfDrivingPrWriteAuthorizationLimits.maxAuthorizationWindowMs) {
    throw new Error("PR write approval lifetime exceeds the 15-minute authorization bound.");
  }

  return Object.freeze({
    schema: SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA,
    state: "approved" as const,
    approvalId,
    operator,
    runtime,
    notBefore,
    expiresAt,
    binding,
  });
}

export async function computeSelfDrivingPrWriteApprovalBindingSha256(
  approval: NormalizedSelfDrivingPrWriteApproval,
): Promise<string> {
  if (!approval || typeof approval !== "object") throw new Error("A normalized PR write approval is required for SHA-256 binding.");
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 digest support is required for PR write approval claims.");
  const digest = await subtle.digest("SHA-256", textEncoder.encode(JSON.stringify(approval)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function claimSelfDrivingPrWriteApproval(
  preflight: SelfDrivingPrPreflight,
  input: SelfDrivingPrWriteApprovalInput,
  claimer: SelfDrivingPrWriteAtomicClaimer,
  options: { now: string },
): Promise<SelfDrivingPrWriteClaimResult> {
  const approval = normalizeSelfDrivingPrWriteApproval(preflight, input);
  if (typeof claimer !== "function") throw new Error("An injected atomic PR write approval claimer is required.");
  if (!options || typeof options !== "object") throw new Error("PR write claim options are required.");
  const requestedAt = normalizeUtcTimestamp(options.now, "now");
  const nowEpoch = Date.parse(requestedAt);
  if (nowEpoch < Date.parse(approval.notBefore)) throw new Error("PR write approval is not active yet.");
  if (nowEpoch >= Date.parse(approval.expiresAt)) throw new Error("PR write approval is expired.");
  const branchProtectionObservedAt = Date.parse(approval.binding.branchProtection.observedAt);
  if (branchProtectionObservedAt > nowEpoch) {
    throw new Error("Branch-protection evidence cannot be observed in the future.");
  }
  if (nowEpoch - branchProtectionObservedAt > defaultSelfDrivingPrWriteAuthorizationLimits.maxBranchProtectionEvidenceAgeMs) {
    throw new Error("Branch-protection evidence is stale for PR write authorization.");
  }
  const approvalBindingSha256 = await computeSelfDrivingPrWriteApprovalBindingSha256(approval);

  const claimRequest: SelfDrivingPrWriteAtomicClaimRequest = Object.freeze({
    schema: SELF_DRIVING_PR_WRITE_CLAIM_SCHEMA,
    expectedState: "approved",
    approvalId: approval.approvalId,
    approvalBindingSha256,
    requestedAt,
    binding: approval,
  });

  const base: Omit<SelfDrivingPrWriteClaimResult, "status"> = {
    schema: SELF_DRIVING_PR_WRITE_CLAIM_SCHEMA,
    approvalId: approval.approvalId,
    approvalBindingSha256,
    preflightId: approval.binding.preflightId,
    requestedAt,
    policy: {
      atomicSingleUseClaimRequired: true,
      cryptographicApprovalBindingRequired: true,
      freshBranchProtectionEvidenceRequired: true,
      writeAuthorizationClaimMutationAttempted: true,
      retries: 0,
      automaticRearm: false,
      githubApiAccess: false,
      credentialResolutionAccess: false,
      tokenMaterialAccepted: false,
      branchCreationAccess: false,
      commitWriteAccess: false,
      pullRequestCreationAccess: false,
      patchApplicationAccess: false,
      shellExecutionAccess: false,
      directPushToBaseAllowed: false,
      directPushToProtectedBranchAllowed: false,
      forcePushAllowed: false,
      repositoryWriteAccess: false,
      mergeAccess: false,
      providerAccess: false,
      networkAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      billingMutationAccess: false,
      solveRunnerAuthority: false,
      credentialMaterialReturned: false,
      writeExecutionStatus: "not-executed",
    },
  };

  let dependencyResult: SelfDrivingPrWriteAtomicClaimDependencyResult;
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
