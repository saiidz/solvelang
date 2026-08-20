import type { RepositorySelectedNodeIntelligence } from "./selectedNodeIntelligence";

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
  workflowGraphId: string | undefined,
  selectedNodeId: string | undefined,
): string | undefined {
  if (!workflowGraphId || !selectedNodeId) return undefined;
  return `${explorerGraphId}:${workflowGraphId}:${selectedNodeId}`;
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
