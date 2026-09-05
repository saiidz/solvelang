import type { RepositorySeverity } from "./inventory";
import {
  SELF_DRIVING_SUGGESTION_SCHEMA,
  type SelfDrivingSuggestionPlan,
  type SelfDrivingSuggestionProposal,
} from "./selfDrivingSuggest";

export const SELF_DRIVING_PATCH_PREVIEW_SCHEMA = "solvelang.self-driving.patch-preview.v0" as const;

export type SelfDrivingPatchHunkInput = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

export type SelfDrivingPatchFileInput = {
  path: string;
  baseBlobSha: string;
  hunks: SelfDrivingPatchHunkInput[];
};

export type SelfDrivingPatchProposalInput = {
  suggestionProposalId: string;
  files: SelfDrivingPatchFileInput[];
};

export type SelfDrivingPatchPreviewProposal = {
  id: string;
  suggestionProposalId: string;
  findingId: string;
  severity: RepositorySeverity;
  files: Array<{
    path: string;
    baseBlobSha: string;
    hunks: SelfDrivingPatchHunkInput[];
  }>;
};

export type SelfDrivingPatchPreview = {
  schema: typeof SELF_DRIVING_PATCH_PREVIEW_SCHEMA;
  mode: "review-only";
  repositoryRevision: string;
  policy: {
    sourceMode: "suggest";
    patchContentIncluded: true;
    structuredTextHunksOnly: true;
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
    maxFilesPerProposal: number;
    maxHunksPerFile: number;
    maxLinesPerHunk: number;
    maxTotalLines: number;
    maxTotalBytes: number;
    maxLineBytes: number;
  };
  source: {
    schema: SelfDrivingSuggestionPlan["schema"];
    status: SelfDrivingSuggestionPlan["execution"]["status"];
    partialReasons: SelfDrivingSuggestionPlan["execution"]["partialReasons"];
    availableProposals: number;
  };
  execution: {
    status: "complete" | "partial";
    partialReasons: Array<"source-suggestion-partial">;
    inputPatchProposals: number;
    emittedPatchProposals: number;
    emittedFiles: number;
    emittedHunks: number;
    emittedLines: number;
    emittedBytes: number;
  };
  proposals: SelfDrivingPatchPreviewProposal[];
};

export const defaultSelfDrivingPatchPreviewLimits = Object.freeze({
  maxPatchProposals: 100,
  maxFilesPerProposal: 16,
  maxHunksPerFile: 64,
  maxLinesPerHunk: 500,
  maxTotalLines: 5_000,
  maxTotalBytes: 262_144,
  maxLineBytes: 4_096,
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

const binaryMarkers = ["GIT binary patch", "Binary files "] as const;
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

function assertArrayBound(items: unknown[], max: number, name: string): void {
  if (items.length > max) throw new Error(`${name} exceeds the ${max}-item safety bound.`);
}

function normalizeSha(value: string, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim().toLowerCase();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(normalized)) {
    throw new Error(`${name} must be an exact 40- or 64-hex revision.`);
  }
  return normalized;
}

function normalizeIdentifier(value: string, name: string, maxLength = 128): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character bound.`);
  if (/[\r\n\u0000-\u001f]/.test(normalized)) throw new Error(`${name} must be single-line text.`);
  return normalized;
}

function hasCredentialLikeText(value: string): boolean {
  return credentialLikePatterns.some((pattern) => pattern.test(value));
}

function normalizePatchLine(value: string, name: string): { line: string; bytes: number } {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  if (value.length === 0 || ![" ", "+", "-"].includes(value[0])) {
    throw new Error(`${name} must start with context, addition, or deletion prefix.`);
  }
  if (/[\r\n]/.test(value)) throw new Error(`${name} must contain exactly one patch line.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error(`${name} contains unsupported control characters.`);
  }
  if (binaryMarkers.some((marker) => value.includes(marker))) throw new Error(`${name} contains a binary patch marker.`);
  if (hasCredentialLikeText(value)) throw new Error(`${name} contains credential-like material.`);
  const bytes = textEncoder.encode(value).length;
  if (bytes > defaultSelfDrivingPatchPreviewLimits.maxLineBytes) {
    throw new Error(`${name} exceeds the ${defaultSelfDrivingPatchPreviewLimits.maxLineBytes}-byte line bound.`);
  }
  return { line: value, bytes };
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer.`);
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`);
}

function assertSafeSuggestionPlan(plan: SelfDrivingSuggestionPlan): void {
  if (!plan || typeof plan !== "object") throw new Error("A canonical Self-Driving Suggestion Plan is required.");
  if (plan.schema !== SELF_DRIVING_SUGGESTION_SCHEMA || plan.mode !== "review-only") {
    throw new Error("Patch preview requires the canonical review-only Suggestion Plan contract.");
  }
  const policy = plan.policy;
  if (
    policy.requestedMode !== "suggest"
    || policy.effectiveMode !== "suggest"
    || policy.sourceAnalysisMode !== "observe"
    || policy.proposalGeneration !== "caller-supplied"
    || policy.patchBytesIncluded !== false
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
    throw new Error("Patch preview requires the safe canonical Suggestion Plan policy boundary.");
  }
  if (!Array.isArray(plan.proposals) || plan.proposals.length !== plan.execution.emittedProposals) {
    throw new Error("Patch preview requires internally consistent Suggestion Plan proposals.");
  }
}

function normalizeHunk(
  input: SelfDrivingPatchHunkInput,
  name: string,
): { hunk: SelfDrivingPatchHunkInput; bytes: number; lines: number } {
  if (!input || typeof input !== "object") throw new Error(`${name} must be an object.`);
  assertPositiveSafeInteger(input.oldStart, `${name}.oldStart`);
  assertPositiveSafeInteger(input.newStart, `${name}.newStart`);
  assertNonNegativeSafeInteger(input.oldLines, `${name}.oldLines`);
  assertNonNegativeSafeInteger(input.newLines, `${name}.newLines`);
  if (input.oldLines === 0 && input.newLines === 0) throw new Error(`${name} must change or retain at least one line.`);
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new Error(`${name}.lines must not be empty.`);
  assertArrayBound(input.lines, defaultSelfDrivingPatchPreviewLimits.maxLinesPerHunk, `${name}.lines`);

  let countedOld = 0;
  let countedNew = 0;
  let bytes = 0;
  const lines = input.lines.map((line, index) => {
    const normalized = normalizePatchLine(line, `${name}.lines[${index}]`);
    bytes += normalized.bytes;
    if (normalized.line[0] === " " || normalized.line[0] === "-") countedOld += 1;
    if (normalized.line[0] === " " || normalized.line[0] === "+") countedNew += 1;
    return normalized.line;
  });
  if (countedOld !== input.oldLines || countedNew !== input.newLines) {
    throw new Error(`${name} line prefixes do not match declared old/new line counts.`);
  }

  return {
    hunk: {
      oldStart: input.oldStart,
      oldLines: input.oldLines,
      newStart: input.newStart,
      newLines: input.newLines,
      lines,
    },
    bytes,
    lines: lines.length,
  };
}

function normalizeFile(
  input: SelfDrivingPatchFileInput,
  allowedPaths: Set<string>,
  name: string,
): { file: SelfDrivingPatchPreviewProposal["files"][number]; bytes: number; lines: number; hunks: number } {
  if (!input || typeof input !== "object") throw new Error(`${name} must be an object.`);
  const path = normalizeIdentifier(input.path, `${name}.path`, 512);
  if (!allowedPaths.has(path)) throw new Error(`${name}.path is not authorized by the source Suggest edit intents.`);
  const baseBlobSha = normalizeSha(input.baseBlobSha, `${name}.baseBlobSha`);
  if (!Array.isArray(input.hunks) || input.hunks.length === 0) throw new Error(`${name}.hunks must not be empty.`);
  assertArrayBound(input.hunks, defaultSelfDrivingPatchPreviewLimits.maxHunksPerFile, `${name}.hunks`);

  let bytes = 0;
  let lines = 0;
  const hunks = input.hunks.map((hunk, index) => {
    const normalized = normalizeHunk(hunk, `${name}.hunks[${index}]`);
    bytes += normalized.bytes;
    lines += normalized.lines;
    return normalized.hunk;
  }).sort((left, right) => left.oldStart - right.oldStart || left.newStart - right.newStart);

  for (let index = 1; index < hunks.length; index += 1) {
    const previous = hunks[index - 1];
    const current = hunks[index];
    const previousEnd = previous.oldStart + Math.max(previous.oldLines, 1) - 1;
    if (current.oldStart <= previousEnd) throw new Error(`${name}.hunks contain overlapping or ambiguous old-file ranges.`);
  }

  return {
    file: { path, baseBlobSha, hunks },
    bytes,
    lines,
    hunks: hunks.length,
  };
}

function normalizePatchProposal(
  input: SelfDrivingPatchProposalInput,
  source: SelfDrivingSuggestionProposal,
  name: string,
): { proposal: SelfDrivingPatchPreviewProposal; bytes: number; lines: number; hunks: number; files: number } {
  if (!input || typeof input !== "object") throw new Error(`${name} must be an object.`);
  if (!Array.isArray(input.files) || input.files.length === 0) throw new Error(`${name}.files must not be empty.`);
  assertArrayBound(input.files, defaultSelfDrivingPatchPreviewLimits.maxFilesPerProposal, `${name}.files`);

  const allowedPaths = new Set(source.edits.map((edit) => edit.path));
  const seenPaths = new Set<string>();
  let bytes = 0;
  let lines = 0;
  let hunks = 0;
  const files = input.files.map((file, index) => {
    const normalized = normalizeFile(file, allowedPaths, `${name}.files[${index}]`);
    if (seenPaths.has(normalized.file.path)) throw new Error(`${name} may target each source edit path only once.`);
    seenPaths.add(normalized.file.path);
    bytes += normalized.bytes;
    lines += normalized.lines;
    hunks += normalized.hunks;
    return normalized.file;
  }).sort((left, right) => compareText(left.path, right.path));

  const missingPaths = [...allowedPaths].filter((path) => !seenPaths.has(path));
  if (missingPaths.length > 0) throw new Error(`${name} must cover every source Suggest edit intent path.`);

  const canonical = JSON.stringify({
    suggestionProposalId: source.id,
    findingId: source.findingId,
    files,
  });
  return {
    proposal: {
      id: `patch_${stableHash(canonical)}`,
      suggestionProposalId: source.id,
      findingId: source.findingId,
      severity: source.severity,
      files,
    },
    bytes,
    lines,
    hunks,
    files: files.length,
  };
}

export function createSelfDrivingPatchPreview(
  suggestionPlan: SelfDrivingSuggestionPlan,
  repositoryRevision: string,
  inputs: SelfDrivingPatchProposalInput[],
): SelfDrivingPatchPreview {
  assertSafeSuggestionPlan(suggestionPlan);
  const revision = normalizeSha(repositoryRevision, "repositoryRevision");
  if (!Array.isArray(inputs)) throw new Error("Patch preview proposals must be an array.");
  assertArrayBound(inputs, defaultSelfDrivingPatchPreviewLimits.maxPatchProposals, "Patch preview proposals");

  const sourceById = new Map(suggestionPlan.proposals.map((proposal) => [proposal.id, proposal]));
  const seenProposalIds = new Set<string>();
  let emittedFiles = 0;
  let emittedHunks = 0;
  let emittedLines = 0;
  let emittedBytes = 0;
  const proposals = inputs.map((input, index) => {
    if (!input || typeof input !== "object") throw new Error(`patches[${index}] must be an object.`);
    const proposalId = normalizeIdentifier(input.suggestionProposalId, `patches[${index}].suggestionProposalId`);
    const source = sourceById.get(proposalId);
    if (!source) throw new Error(`Patch preview references an unknown Suggest proposal: ${proposalId}`);
    if (seenProposalIds.has(proposalId)) throw new Error(`Only one patch preview may bind to Suggest proposal ${proposalId}.`);
    seenProposalIds.add(proposalId);
    const normalized = normalizePatchProposal({ ...input, suggestionProposalId: proposalId }, source, `patches[${index}]`);
    emittedFiles += normalized.files;
    emittedHunks += normalized.hunks;
    emittedLines += normalized.lines;
    emittedBytes += normalized.bytes;
    return normalized.proposal;
  }).sort((left, right) =>
    severityRank[left.severity] - severityRank[right.severity]
    || compareText(left.findingId, right.findingId)
    || compareText(left.suggestionProposalId, right.suggestionProposalId)
    || compareText(left.id, right.id));

  if (emittedLines > defaultSelfDrivingPatchPreviewLimits.maxTotalLines) {
    throw new Error(`Patch preview exceeds the ${defaultSelfDrivingPatchPreviewLimits.maxTotalLines}-line total bound.`);
  }
  if (emittedBytes > defaultSelfDrivingPatchPreviewLimits.maxTotalBytes) {
    throw new Error(`Patch preview exceeds the ${defaultSelfDrivingPatchPreviewLimits.maxTotalBytes}-byte total bound.`);
  }

  const sourcePartial = suggestionPlan.execution.status === "partial";
  return {
    schema: SELF_DRIVING_PATCH_PREVIEW_SCHEMA,
    mode: "review-only",
    repositoryRevision: revision,
    policy: {
      sourceMode: "suggest",
      patchContentIncluded: true,
      structuredTextHunksOnly: true,
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
    limits: { ...defaultSelfDrivingPatchPreviewLimits },
    source: {
      schema: suggestionPlan.schema,
      status: suggestionPlan.execution.status,
      partialReasons: [...suggestionPlan.execution.partialReasons],
      availableProposals: suggestionPlan.execution.emittedProposals,
    },
    execution: {
      status: sourcePartial ? "partial" : "complete",
      partialReasons: sourcePartial ? ["source-suggestion-partial"] : [],
      inputPatchProposals: inputs.length,
      emittedPatchProposals: proposals.length,
      emittedFiles,
      emittedHunks,
      emittedLines,
      emittedBytes,
    },
    proposals,
  };
}
