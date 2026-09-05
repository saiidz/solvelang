import type { RepositorySeverity } from "./inventory";
import type { ScoutProvenance, SolveInboxItem } from "./selfDriving";
import type { SelfDrivingObserveRun } from "./selfDrivingObserveRun";

export const SELF_DRIVING_SUGGESTION_SCHEMA = "solvelang.self-driving.suggestion-plan.v0" as const;

export const SUGGESTION_VALIDATION_KINDS = ["test", "lint", "build", "review"] as const;
export type SuggestionValidationKind = (typeof SUGGESTION_VALIDATION_KINDS)[number];

export type SuggestionEditIntentInput = {
  path: string;
  purpose: string;
};

export type SuggestionValidationStepInput = {
  kind: SuggestionValidationKind;
  label: string;
};

export type SelfDrivingSuggestionProposalInput = {
  findingId: string;
  title: string;
  rationale: string;
  edits: SuggestionEditIntentInput[];
  validations: SuggestionValidationStepInput[];
};

export type SelfDrivingSuggestionProposal = {
  id: string;
  findingId: string;
  scout: SolveInboxItem["scout"];
  severity: RepositorySeverity;
  findingTitle: string;
  title: string;
  rationale: string;
  provenance: ScoutProvenance[];
  edits: SuggestionEditIntentInput[];
  validations: SuggestionValidationStepInput[];
};

export type SelfDrivingSuggestionPlan = {
  schema: typeof SELF_DRIVING_SUGGESTION_SCHEMA;
  mode: "review-only";
  policy: {
    requestedMode: "suggest";
    effectiveMode: "suggest";
    sourceAnalysisMode: "observe";
    proposalGeneration: "caller-supplied";
    patchBytesIncluded: false;
    patchApplicationAccess: false;
    shellExecutionAccess: false;
    githubWriteAccess: false;
    repositoryWriteAccess: false;
    providerAccess: false;
    networkAccess: false;
    credentialAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    externalSideEffects: false;
  };
  limits: {
    maxProposals: number;
    maxEditsPerProposal: number;
    maxValidationsPerProposal: number;
    maxPathLength: number;
    maxTitleLength: number;
    maxRationaleLength: number;
    maxPurposeLength: number;
    maxValidationLabelLength: number;
  };
  source: {
    observeRunSchema: SelfDrivingObserveRun["schema"];
    inboxSchema: SelfDrivingObserveRun["inbox"]["schema"];
    observeStatus: SelfDrivingObserveRun["execution"]["status"];
    observePartialReasons: SelfDrivingObserveRun["execution"]["partialReasons"];
    inboxStatus: SelfDrivingObserveRun["inbox"]["execution"]["status"];
    emittedFindings: number;
  };
  execution: {
    status: "complete" | "partial";
    partialReasons: Array<"source-observe-partial">;
    inputProposals: number;
    emittedProposals: number;
  };
  proposals: SelfDrivingSuggestionProposal[];
};

export const defaultSelfDrivingSuggestionLimits = Object.freeze({
  maxProposals: 200,
  maxEditsPerProposal: 16,
  maxValidationsPerProposal: 16,
  maxPathLength: 512,
  maxTitleLength: 256,
  maxRationaleLength: 2_048,
  maxPurposeLength: 1_024,
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

function assertArrayBound(items: unknown[], max: number, name: string): void {
  if (items.length > max) throw new Error(`${name} exceeds the ${max}-item safety bound.`);
}

function hasCredentialLikeText(value: string): boolean {
  return credentialLikePatterns.some((pattern) => pattern.test(value));
}

function normalizeReviewText(value: string, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`${name} must be a single-line review value.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty.`);
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character bound.`);
  if (hasCredentialLikeText(normalized)) throw new Error(`${name} contains credential-like material.`);
  return normalized;
}

function normalizeRepoPath(value: string, name: string): string {
  const path = normalizeReviewText(value, name, defaultSelfDrivingSuggestionLimits.maxPathLength);
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`${name} must be repository-relative.`);
  }
  if (path.includes("\\")) throw new Error(`${name} must use forward slashes.`);
  if (path.startsWith("./") || path.endsWith("/")) throw new Error(`${name} must use a canonical repository-relative path.`);
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`${name} contains an unsafe path segment.`);
  }
  if (segments[0].toLowerCase() === ".git") throw new Error(`${name} may not target Git metadata.`);
  return path;
}

function normalizeValidationKind(value: string, name: string): SuggestionValidationKind {
  if (!SUGGESTION_VALIDATION_KINDS.includes(value as SuggestionValidationKind)) {
    throw new Error(`${name} is not supported: ${value}`);
  }
  return value as SuggestionValidationKind;
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

function assertSafeObserveRun(run: SelfDrivingObserveRun): void {
  if (!run || typeof run !== "object") throw new Error("A canonical Self-Driving Observe Run is required.");
  if (run.schema !== "solvelang.self-driving.observe-run.v0" || run.mode !== "analyze-only") {
    throw new Error("Suggestion planning requires the canonical analyze-only Observe Run contract.");
  }
  const policy = run.policy;
  if (
    policy.requestedMode !== "observe"
    || policy.effectiveMode !== "observe"
    || policy.explicitEvidenceOnly !== true
    || policy.callerSuppliedBudgetsOnly !== true
    || policy.causalityInference !== false
    || policy.providerAccess !== false
    || policy.networkAccess !== false
    || policy.credentialAccess !== false
    || policy.repositoryWriteAccess !== false
    || policy.rolloutMutationAccess !== false
    || policy.productionMutationAccess !== false
    || policy.externalSideEffects !== false
  ) {
    throw new Error("Suggestion planning requires the safe canonical Observe policy boundary.");
  }
  const inbox = run.inbox;
  if (
    inbox.schema !== "solvelang.self-driving.inbox.v0"
    || inbox.mode !== "analyze-only"
    || inbox.policy.requestedMode !== "observe"
    || inbox.policy.effectiveMode !== "observe"
    || inbox.policy.repositoryWriteAccess !== false
    || inbox.policy.productionMutationAccess !== false
    || inbox.policy.externalSideEffects !== false
    || inbox.policy.allowedActions.length !== 1
    || inbox.policy.allowedActions[0] !== "inspect"
  ) {
    throw new Error("Suggestion planning requires the safe canonical Solve Inbox policy boundary.");
  }
  if (!Array.isArray(inbox.items) || inbox.items.length !== inbox.execution.emittedFindings) {
    throw new Error("Suggestion planning requires internally consistent emitted Inbox findings.");
  }
}

function normalizeProposal(
  input: SelfDrivingSuggestionProposalInput,
  finding: SolveInboxItem,
): SelfDrivingSuggestionProposal {
  if (!input || typeof input !== "object") throw new Error("Suggestion proposals must be objects.");
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error("Each suggestion proposal requires at least one edit intent.");
  }
  if (!Array.isArray(input.validations) || input.validations.length === 0) {
    throw new Error("Each suggestion proposal requires at least one validation step.");
  }
  assertArrayBound(input.edits, defaultSelfDrivingSuggestionLimits.maxEditsPerProposal, "Suggestion edit intents");
  assertArrayBound(input.validations, defaultSelfDrivingSuggestionLimits.maxValidationsPerProposal, "Suggestion validation steps");

  const title = normalizeReviewText(input.title, "proposal.title", defaultSelfDrivingSuggestionLimits.maxTitleLength);
  const rationale = normalizeReviewText(input.rationale, "proposal.rationale", defaultSelfDrivingSuggestionLimits.maxRationaleLength);
  const edits = input.edits.map((edit, index) => {
    if (!edit || typeof edit !== "object") throw new Error(`proposal.edits[${index}] must be an object.`);
    return {
      path: normalizeRepoPath(edit.path, `proposal.edits[${index}].path`),
      purpose: normalizeReviewText(
        edit.purpose,
        `proposal.edits[${index}].purpose`,
        defaultSelfDrivingSuggestionLimits.maxPurposeLength,
      ),
    };
  }).sort((left, right) => compareText(left.path, right.path) || compareText(left.purpose, right.purpose));

  const duplicatePath = edits.find((edit, index) => index > 0 && edit.path === edits[index - 1].path);
  if (duplicatePath) throw new Error(`A suggestion proposal may target each path only once: ${duplicatePath.path}`);

  const validations = input.validations.map((validation, index) => {
    if (!validation || typeof validation !== "object") {
      throw new Error(`proposal.validations[${index}] must be an object.`);
    }
    return {
      kind: normalizeValidationKind(validation.kind, `proposal.validations[${index}].kind`),
      label: normalizeReviewText(
        validation.label,
        `proposal.validations[${index}].label`,
        defaultSelfDrivingSuggestionLimits.maxValidationLabelLength,
      ),
    };
  }).sort((left, right) => compareText(left.kind, right.kind) || compareText(left.label, right.label));

  const canonical = JSON.stringify({
    findingId: finding.id,
    title,
    rationale,
    edits,
    validations,
  });

  return {
    id: `suggest_${stableHash(canonical)}`,
    findingId: finding.id,
    scout: finding.scout,
    severity: finding.severity,
    findingTitle: finding.title,
    title,
    rationale,
    provenance: finding.provenance.map((entry) => ({ ...entry })),
    edits,
    validations,
  };
}

export function createSelfDrivingSuggestionPlan(
  observeRun: SelfDrivingObserveRun,
  inputs: SelfDrivingSuggestionProposalInput[],
): SelfDrivingSuggestionPlan {
  assertSafeObserveRun(observeRun);
  if (!Array.isArray(inputs)) throw new Error("Suggestion proposals must be an array.");
  assertArrayBound(inputs, defaultSelfDrivingSuggestionLimits.maxProposals, "Suggestion proposals");

  const findings = new Map(observeRun.inbox.items.map((item) => [item.id, item]));
  const seenFindingIds = new Set<string>();
  const proposals = inputs.map((input, index) => {
    if (!input || typeof input !== "object") throw new Error(`suggestions[${index}] must be an object.`);
    const findingId = normalizeReviewText(input.findingId, `suggestions[${index}].findingId`, 128);
    const finding = findings.get(findingId);
    if (!finding) throw new Error(`Suggestion references an unknown emitted Inbox finding: ${findingId}`);
    if (seenFindingIds.has(findingId)) throw new Error(`Only one suggestion proposal may bind to finding ${findingId}.`);
    seenFindingIds.add(findingId);
    return normalizeProposal({ ...input, findingId }, finding);
  }).sort((left, right) =>
    severityRank[left.severity] - severityRank[right.severity]
    || compareText(left.scout, right.scout)
    || compareText(left.findingTitle, right.findingTitle)
    || compareText(left.findingId, right.findingId)
    || compareText(left.id, right.id));

  const sourcePartial = observeRun.execution.status === "partial";
  return {
    schema: SELF_DRIVING_SUGGESTION_SCHEMA,
    mode: "review-only",
    policy: {
      requestedMode: "suggest",
      effectiveMode: "suggest",
      sourceAnalysisMode: "observe",
      proposalGeneration: "caller-supplied",
      patchBytesIncluded: false,
      patchApplicationAccess: false,
      shellExecutionAccess: false,
      githubWriteAccess: false,
      repositoryWriteAccess: false,
      providerAccess: false,
      networkAccess: false,
      credentialAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      externalSideEffects: false,
    },
    limits: { ...defaultSelfDrivingSuggestionLimits },
    source: {
      observeRunSchema: observeRun.schema,
      inboxSchema: observeRun.inbox.schema,
      observeStatus: observeRun.execution.status,
      observePartialReasons: [...observeRun.execution.partialReasons],
      inboxStatus: observeRun.inbox.execution.status,
      emittedFindings: observeRun.inbox.execution.emittedFindings,
    },
    execution: {
      status: sourcePartial ? "partial" : "complete",
      partialReasons: sourcePartial ? ["source-observe-partial"] : [],
      inputProposals: inputs.length,
      emittedProposals: proposals.length,
    },
    proposals,
  };
}
