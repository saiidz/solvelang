import type { RepositorySelectedNodeIntelligence } from "./selectedNodeIntelligence";
import type { RepositoryWorkflowPathEvidenceAnalysis } from "./workflowPathEvidence";
import { canonicalRepositoryAuditJson } from "./reportIntegrity";

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

export function createRepositorySelectedNodeIntelligenceRequestKey(
  explorerGraphId: string,
  workflowEvidence: RepositoryWorkflowPathEvidenceAnalysis | undefined,
  selectedNodeId: string | undefined,
): string | undefined {
  if (!workflowEvidence || !selectedNodeId) return undefined;
  return `selected-intelligence:${canonicalRepositoryAuditJson({
    explorerGraphId,
    selectedNodeId,
    workflowEvidence,
  })}`;
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
