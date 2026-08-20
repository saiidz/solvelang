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

function createWorkflowEvidenceRevision(workflowEvidence: RepositoryWorkflowPathEvidenceAnalysis): string {
  return JSON.stringify([
    workflowEvidence.status,
    workflowEvidence.references.map((reference) => [reference.referenceId, reference.targetState]),
    workflowEvidence.skipped.missingText,
    workflowEvidence.skipped.oversizedText,
    workflowEvidence.skipped.dynamicReferences,
    workflowEvidence.skipped.multilineReferences,
    workflowEvidence.execution.referencesTruncated,
    workflowEvidence.execution.graphTruncated,
  ]);
}

export function createRepositorySelectedNodeIntelligenceRequestKey(
  explorerGraphId: string,
  workflowEvidence: RepositoryWorkflowPathEvidenceAnalysis | undefined,
  selectedNodeId: string | undefined,
): string | undefined {
  if (!workflowEvidence || !selectedNodeId) return undefined;
  return JSON.stringify([
    explorerGraphId,
    workflowEvidence.graphId,
    selectedNodeId,
    createWorkflowEvidenceRevision(workflowEvidence),
  ]);
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
