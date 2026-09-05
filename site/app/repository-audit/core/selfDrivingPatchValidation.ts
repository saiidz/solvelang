import type { RepositorySeverity } from "./inventory";
import {
  SELF_DRIVING_PATCH_PREVIEW_SCHEMA,
  type SelfDrivingPatchPreview,
  type SelfDrivingPatchPreviewProposal,
} from "./selfDrivingPatchPreview";
import {
  SELF_DRIVING_SUGGESTION_SCHEMA,
  type SelfDrivingSuggestionPlan,
  type SelfDrivingSuggestionProposal,
  type SuggestionValidationKind,
} from "./selfDrivingSuggest";

export const SELF_DRIVING_PATCH_VALIDATION_SCHEMA = "solvelang.self-driving.patch-validation.v0" as const;
export const PATCH_VALIDATION_STATUSES = ["passed", "failed", "blocked"] as const;
export type PatchValidationStatus = (typeof PATCH_VALIDATION_STATUSES)[number];

export type PatchValidationEvidenceInput = {
  kind: SuggestionValidationKind;
  label: string;
  status: PatchValidationStatus;
  observedAt: string;
  evidenceLocator: string;
};

export type PatchProposalValidationInput = {
  patchProposalId: string;
  results: PatchValidationEvidenceInput[];
};

export type PatchValidationEvidence = PatchValidationEvidenceInput & {
  requirementId: string;
};

export type PatchProposalValidation = {
  id: string;
  patchProposalId: string;
  suggestionProposalId: string;
  findingId: string;
  severity: RepositorySeverity;
  status: PatchValidationStatus;
  reviewReady: boolean;
  results: PatchValidationEvidence[];
};

export type SelfDrivingPatchValidation = {
  schema: typeof SELF_DRIVING_PATCH_VALIDATION_SCHEMA;
  mode: "review-only";
  repositoryRevision: string;
  policy: {
    sourceMode: "suggest";
    evidenceSource: "caller-supplied";
    validationExecutionAccess: false;
    patchApplicationAccess: false;
    shellExecutionAccess: false;
    githubWriteAccess: false;
    repositoryWriteAccess: false;
    providerAccess: false;
    networkAccess: false;
    credentialAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    billingMutationAccess: false;
    solveRunnerAuthority: false;
    externalSideEffects: false;
  };
  limits: {
    maxPatchProposals: number;
    maxResultsPerProposal: number;
    maxEvidenceLocatorLength: number;
    maxValidationLabelLength: number;
  };
  source: {
    suggestionSchema: SelfDrivingSuggestionPlan["schema"];
    patchPreviewSchema: SelfDrivingPatchPreview["schema"];
    suggestionStatus: SelfDrivingSuggestionPlan["execution"]["status"];
    patchPreviewStatus: SelfDrivingPatchPreview["execution"]["status"];
    patchProposals: number;
  };
  execution: {
    status: "complete" | "partial";
    partialReasons: Array<"source-suggestion-partial" | "source-patch-preview-partial">;
    validatedProposals: number;
    passedProposals: number;
    failedProposals: number;
    blockedProposals: number;
    reviewReadyProposals: number;
  };
  proposals: PatchProposalValidation[];
};

export const defaultSelfDrivingPatchValidationLimits = Object.freeze({
  maxPatchProposals: 100,
  maxResultsPerProposal: 16,
  maxEvidenceLocatorLength: 512,
  maxValidationLabelLength: 256,
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

function normalizeUtcTimestamp(value: string, name: string): string {
  const normalized = normalizeText(value, name, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)) {
    throw new Error(`${name} must be an explicit UTC timestamp.`);
  }
  const epoch = Date.parse(normalized);
  if (!Number.isFinite(epoch)) throw new Error(`${name} must be a valid UTC timestamp.`);
  return new Date(epoch).toISOString();
}

function normalizeStatus(value: string, name: string): PatchValidationStatus {
  if (!PATCH_VALIDATION_STATUSES.includes(value as PatchValidationStatus)) {
    throw new Error(`${name} is not supported: ${value}`);
  }
  return value as PatchValidationStatus;
}

function requirementKey(kind: SuggestionValidationKind, label: string): string {
  return `${kind}\u0000${label}`;
}

function requirementId(source: SelfDrivingSuggestionProposal, kind: SuggestionValidationKind, label: string): string {
  return `validation_${stableHash(JSON.stringify({ proposalId: source.id, kind, label }))}`;
}

function assertSafeSuggestionPlan(plan: SelfDrivingSuggestionPlan): void {
  if (!plan || typeof plan !== "object") throw new Error("A canonical Suggestion Plan is required.");
  if (plan.schema !== SELF_DRIVING_SUGGESTION_SCHEMA || plan.mode !== "review-only") {
    throw new Error("Patch validation requires the canonical review-only Suggestion Plan.");
  }
  const policy = plan.policy;
  if (
    policy.requestedMode !== "suggest"
    || policy.effectiveMode !== "suggest"
    || policy.patchApplicationAccess !== false
    || policy.shellExecutionAccess !== false
    || policy.githubWriteAccess !== false
    || policy.repositoryWriteAccess !== false
    || policy.providerAccess !== false
    || policy.networkAccess !== false
    || policy.credentialAccess !== false
    || policy.rolloutMutationAccess !== false
    || policy.productionMutationAccess !== false
    || policy.externalSideEffects !== false
  ) {
    throw new Error("Patch validation requires the safe Suggestion Plan policy boundary.");
  }
}

function assertSafePatchPreview(preview: SelfDrivingPatchPreview): void {
  if (!preview || typeof preview !== "object") throw new Error("A canonical Patch Preview is required.");
  if (preview.schema !== SELF_DRIVING_PATCH_PREVIEW_SCHEMA || preview.mode !== "review-only") {
    throw new Error("Patch validation requires the canonical review-only Patch Preview.");
  }
  const policy = preview.policy;
  if (
    policy.sourceMode !== "suggest"
    || policy.patchContentIncluded !== true
    || policy.structuredTextHunksOnly !== true
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
    throw new Error("Patch validation requires the safe Patch Preview policy boundary.");
  }
}

function assertSourceConsistency(plan: SelfDrivingSuggestionPlan, preview: SelfDrivingPatchPreview): void {
  if (preview.source.schema !== plan.schema) throw new Error("Patch Preview source schema does not match the Suggestion Plan.");
  if (preview.source.status !== plan.execution.status) throw new Error("Patch Preview source status does not match the Suggestion Plan.");
  if (preview.source.availableProposals !== plan.execution.emittedProposals) {
    throw new Error("Patch Preview source proposal count does not match the Suggestion Plan.");
  }
  const suggestionById = new Map(plan.proposals.map((proposal) => [proposal.id, proposal]));
  for (const patch of preview.proposals) {
    const source = suggestionById.get(patch.suggestionProposalId);
    if (!source || source.findingId !== patch.findingId || source.severity !== patch.severity) {
      throw new Error("Patch Preview proposal identity does not match its source Suggestion proposal.");
    }
  }
}

function requiredValidations(source: SelfDrivingSuggestionProposal): Map<string, { kind: SuggestionValidationKind; label: string; id: string }> {
  const required = new Map<string, { kind: SuggestionValidationKind; label: string; id: string }>();
  for (const validation of source.validations) {
    const key = requirementKey(validation.kind, validation.label);
    if (required.has(key)) throw new Error("Source Suggestion proposal contains ambiguous duplicate validation requirements.");
    required.set(key, {
      kind: validation.kind,
      label: validation.label,
      id: requirementId(source, validation.kind, validation.label),
    });
  }
  return required;
}

function aggregateStatus(results: PatchValidationEvidence[]): PatchValidationStatus {
  if (results.some((result) => result.status === "failed")) return "failed";
  if (results.some((result) => result.status === "blocked")) return "blocked";
  return "passed";
}

function normalizeProposalEvidence(
  sourceSuggestion: SelfDrivingSuggestionProposal,
  sourcePatch: SelfDrivingPatchPreviewProposal,
  input: PatchProposalValidationInput,
  sourceComplete: boolean,
  name: string,
): PatchProposalValidation {
  if (!Array.isArray(input.results)) throw new Error(`${name}.results must be an array.`);
  if (input.results.length > defaultSelfDrivingPatchValidationLimits.maxResultsPerProposal) {
    throw new Error(`${name}.results exceeds the ${defaultSelfDrivingPatchValidationLimits.maxResultsPerProposal}-item safety bound.`);
  }

  const required = requiredValidations(sourceSuggestion);
  if (input.results.length !== required.size) {
    throw new Error(`${name}.results must cover every source Suggest validation requirement exactly once.`);
  }

  const seen = new Set<string>();
  const results = input.results.map((inputResult, index) => {
    if (!inputResult || typeof inputResult !== "object") throw new Error(`${name}.results[${index}] must be an object.`);
    const kind = inputResult.kind;
    const label = normalizeText(
      inputResult.label,
      `${name}.results[${index}].label`,
      defaultSelfDrivingPatchValidationLimits.maxValidationLabelLength,
    );
    const key = requirementKey(kind, label);
    const requirement = required.get(key);
    if (!requirement) throw new Error(`${name}.results[${index}] is not declared by the source Suggest validation plan.`);
    if (seen.has(key)) throw new Error(`${name}.results contain duplicate evidence for one validation requirement.`);
    seen.add(key);
    return {
      requirementId: requirement.id,
      kind: requirement.kind,
      label: requirement.label,
      status: normalizeStatus(inputResult.status, `${name}.results[${index}].status`),
      observedAt: normalizeUtcTimestamp(inputResult.observedAt, `${name}.results[${index}].observedAt`),
      evidenceLocator: normalizeText(
        inputResult.evidenceLocator,
        `${name}.results[${index}].evidenceLocator`,
        defaultSelfDrivingPatchValidationLimits.maxEvidenceLocatorLength,
      ),
    };
  }).sort((left, right) => compareText(left.requirementId, right.requirementId));

  if (seen.size !== required.size) throw new Error(`${name}.results do not cover all source validation requirements.`);
  const status = aggregateStatus(results);
  const canonical = JSON.stringify({
    patchProposalId: sourcePatch.id,
    suggestionProposalId: sourceSuggestion.id,
    repositoryBinding: sourcePatch.files.map((file) => ({ path: file.path, baseBlobSha: file.baseBlobSha })),
    results,
  });

  return {
    id: `validated_${stableHash(canonical)}`,
    patchProposalId: sourcePatch.id,
    suggestionProposalId: sourceSuggestion.id,
    findingId: sourcePatch.findingId,
    severity: sourcePatch.severity,
    status,
    reviewReady: sourceComplete && status === "passed",
    results,
  };
}

export function createSelfDrivingPatchValidation(
  suggestionPlan: SelfDrivingSuggestionPlan,
  patchPreview: SelfDrivingPatchPreview,
  inputs: PatchProposalValidationInput[],
): SelfDrivingPatchValidation {
  assertSafeSuggestionPlan(suggestionPlan);
  assertSafePatchPreview(patchPreview);
  assertSourceConsistency(suggestionPlan, patchPreview);
  if (!Array.isArray(inputs)) throw new Error("Patch validation evidence must be an array.");
  if (inputs.length > defaultSelfDrivingPatchValidationLimits.maxPatchProposals) {
    throw new Error(`Patch validation evidence exceeds the ${defaultSelfDrivingPatchValidationLimits.maxPatchProposals}-proposal safety bound.`);
  }
  if (inputs.length !== patchPreview.proposals.length) {
    throw new Error("Patch validation evidence must cover every Patch Preview proposal exactly once.");
  }

  const patchById = new Map(patchPreview.proposals.map((proposal) => [proposal.id, proposal]));
  const suggestionById = new Map(suggestionPlan.proposals.map((proposal) => [proposal.id, proposal]));
  const seen = new Set<string>();
  const sourceComplete = suggestionPlan.execution.status === "complete" && patchPreview.execution.status === "complete";

  const proposals = inputs.map((input, index) => {
    if (!input || typeof input !== "object") throw new Error(`validations[${index}] must be an object.`);
    const patchProposalId = normalizeText(input.patchProposalId, `validations[${index}].patchProposalId`, 128);
    const patch = patchById.get(patchProposalId);
    if (!patch) throw new Error(`Patch validation references an unknown Patch Preview proposal: ${patchProposalId}`);
    if (seen.has(patchProposalId)) throw new Error(`Patch validation may bind each Patch Preview proposal only once: ${patchProposalId}`);
    seen.add(patchProposalId);
    const suggestion = suggestionById.get(patch.suggestionProposalId);
    if (!suggestion) throw new Error("Patch validation cannot resolve the source Suggestion proposal.");
    return normalizeProposalEvidence(suggestion, patch, { ...input, patchProposalId }, sourceComplete, `validations[${index}]`);
  }).sort((left, right) =>
    severityRank[left.severity] - severityRank[right.severity]
    || compareText(left.findingId, right.findingId)
    || compareText(left.patchProposalId, right.patchProposalId)
    || compareText(left.id, right.id));

  const partialReasons: SelfDrivingPatchValidation["execution"]["partialReasons"] = [];
  if (suggestionPlan.execution.status === "partial") partialReasons.push("source-suggestion-partial");
  if (patchPreview.execution.status === "partial") partialReasons.push("source-patch-preview-partial");

  return {
    schema: SELF_DRIVING_PATCH_VALIDATION_SCHEMA,
    mode: "review-only",
    repositoryRevision: patchPreview.repositoryRevision,
    policy: {
      sourceMode: "suggest",
      evidenceSource: "caller-supplied",
      validationExecutionAccess: false,
      patchApplicationAccess: false,
      shellExecutionAccess: false,
      githubWriteAccess: false,
      repositoryWriteAccess: false,
      providerAccess: false,
      networkAccess: false,
      credentialAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      billingMutationAccess: false,
      solveRunnerAuthority: false,
      externalSideEffects: false,
    },
    limits: { ...defaultSelfDrivingPatchValidationLimits },
    source: {
      suggestionSchema: suggestionPlan.schema,
      patchPreviewSchema: patchPreview.schema,
      suggestionStatus: suggestionPlan.execution.status,
      patchPreviewStatus: patchPreview.execution.status,
      patchProposals: patchPreview.proposals.length,
    },
    execution: {
      status: partialReasons.length === 0 ? "complete" : "partial",
      partialReasons,
      validatedProposals: proposals.length,
      passedProposals: proposals.filter((proposal) => proposal.status === "passed").length,
      failedProposals: proposals.filter((proposal) => proposal.status === "failed").length,
      blockedProposals: proposals.filter((proposal) => proposal.status === "blocked").length,
      reviewReadyProposals: proposals.filter((proposal) => proposal.reviewReady).length,
    },
    proposals,
  };
}
