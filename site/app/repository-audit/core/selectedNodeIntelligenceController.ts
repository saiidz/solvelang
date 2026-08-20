import type { RepositorySelectedNodeIntelligence } from "./selectedNodeIntelligence";
import type { RepositoryWorkflowPathEvidenceAnalysis } from "./workflowPathEvidence";

export type RepositorySelectedNodeIntelligenceRequestState = {
  requestKey: string;
  product?: RepositorySelectedNodeIntelligence;
  error?: string;
};

export type RepositorySelectedNodeIntelligenceViewState = {
  requestKey?: string;
  product?: RepositorySelectedNodeIntelligence;
  error: string;
  pending: boolean;
};

type CompactIdentityHash = [number, number, number, number];

const COMPACT_IDENTITY_SEEDS: CompactIdentityHash = [
  0x811c9dc5,
  0x9e3779b9,
  0x85ebca6b,
  0xc2b2ae35,
];
const COMPACT_IDENTITY_PRIMES: CompactIdentityHash = [
  0x01000193,
  0x27d4eb2d,
  0x165667b1,
  0x85ebca77,
];

function mixCompactIdentityNumber(hash: CompactIdentityHash, value: number): void {
  const text = String(value);
  mixCompactIdentityString(hash, text);
}

function mixCompactIdentityString(hash: CompactIdentityHash, value: string): void {
  const length = value.length;
  for (let index = 0; index < hash.length; index += 1) {
    hash[index] = Math.imul(hash[index] ^ length, COMPACT_IDENTITY_PRIMES[index]) >>> 0;
  }
  for (let offset = 0; offset < value.length; offset += 1) {
    const code = value.charCodeAt(offset);
    for (let index = 0; index < hash.length; index += 1) {
      hash[index] = Math.imul(hash[index] ^ code, COMPACT_IDENTITY_PRIMES[index]) >>> 0;
    }
  }
}

function compactWorkflowEvidenceIdentity(
  workflowEvidence: RepositoryWorkflowPathEvidenceAnalysis,
): string {
  const hash: CompactIdentityHash = [...COMPACT_IDENTITY_SEEDS];
  const mixBoolean = (value: boolean) => mixCompactIdentityNumber(hash, value ? 1 : 0);

  mixCompactIdentityString(hash, workflowEvidence.schema);
  mixCompactIdentityString(hash, workflowEvidence.mode);
  mixCompactIdentityString(hash, workflowEvidence.graphId);
  mixCompactIdentityString(hash, workflowEvidence.status);
  mixCompactIdentityNumber(hash, workflowEvidence.references.length);
  for (const reference of workflowEvidence.references) {
    // Hash only the structural fields consumed by selected-node affected-validation.
    // This intentionally avoids retaining the full canonical evidence JSON, duplicated
    // raw references, or the derived impact index in browser request state.
    mixCompactIdentityString(hash, reference.workflowPath);
    mixCompactIdentityString(hash, reference.kind);
    mixCompactIdentityString(hash, reference.targetPath);
    mixCompactIdentityString(hash, reference.targetState);
    mixCompactIdentityString(hash, reference.evidence.path);
    mixCompactIdentityNumber(hash, reference.evidence.line);
  }

  mixCompactIdentityNumber(hash, workflowEvidence.skipped.missingText);
  mixCompactIdentityNumber(hash, workflowEvidence.skipped.oversizedText);
  mixCompactIdentityNumber(hash, workflowEvidence.skipped.dynamicReferences);
  mixCompactIdentityNumber(hash, workflowEvidence.skipped.multilineReferences);
  mixCompactIdentityNumber(hash, workflowEvidence.execution.maxReferences);
  mixCompactIdentityNumber(hash, workflowEvidence.execution.maxWorkflowTextBytes);
  mixBoolean(workflowEvidence.execution.referencesTruncated);
  mixCompactIdentityNumber(hash, workflowEvidence.execution.acceptedFiles);
  mixCompactIdentityNumber(hash, workflowEvidence.execution.workflowFilesExamined);
  mixBoolean(workflowEvidence.execution.graphTruncated);
  mixBoolean(workflowEvidence.execution.networkAccess);
  mixBoolean(workflowEvidence.execution.writeAccess);

  return hash.map((part) => part.toString(16).padStart(8, "0")).join("");
}

export function createRepositorySelectedNodeIntelligenceRequestKey(
  explorerGraphId: string,
  workflowEvidence: RepositoryWorkflowPathEvidenceAnalysis | undefined,
  selectedNodeId: string | undefined,
): string | undefined {
  if (!workflowEvidence || !selectedNodeId) return undefined;
  const workflowIdentity = compactWorkflowEvidenceIdentity(workflowEvidence);
  const hash: CompactIdentityHash = [...COMPACT_IDENTITY_SEEDS];
  mixCompactIdentityString(hash, "selected-intelligence.v1");
  mixCompactIdentityString(hash, explorerGraphId);
  mixCompactIdentityString(hash, selectedNodeId);
  mixCompactIdentityString(hash, workflowIdentity);
  return `selected-intelligence:v1:${hash.map((part) => part.toString(16).padStart(8, "0")).join("")}`;
}

export function resolveRepositorySelectedNodeIntelligenceViewState(
  explorerGraphId: string,
  selectedNodeId: string | undefined,
  requestKey: string | undefined,
  state: RepositorySelectedNodeIntelligenceRequestState | undefined,
): RepositorySelectedNodeIntelligenceViewState {
  if (!requestKey || !selectedNodeId) {
    return { requestKey, error: "", pending: false };
  }

  if (!state || state.requestKey !== requestKey) {
    return { requestKey, error: "", pending: true };
  }

  const product = state.product;
  const activeProduct = product
    && product.graphId === explorerGraphId
    && product.selectedNodeId === selectedNodeId
    ? product
    : undefined;

  return {
    requestKey,
    ...(activeProduct ? { product: activeProduct } : {}),
    error: state.error ?? "",
    pending: false,
  };
}
