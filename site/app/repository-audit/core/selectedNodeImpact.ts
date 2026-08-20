import {
  createSolveGraphImpactQueryProduct,
  type SolveGraphImpactQueryProduct,
} from "../../solve-graph/core/impact-query-product";
import type { SolveGraphQueryIndex } from "../../solve-graph/core/query-impact";
import type { RepositoryAuditVisualExplorer } from "./visualExplorer";

export type RepositoryAuditSelectedNodeImpactOptions = {
  maxDepth?: number;
  maxResults?: number;
  maxRows?: number;
};

export function createRepositoryAuditSelectedNodeImpactProduct(
  explorer: RepositoryAuditVisualExplorer,
  index: SolveGraphQueryIndex,
  selectedNodeId: string | undefined,
  options: RepositoryAuditSelectedNodeImpactOptions = {},
): SolveGraphImpactQueryProduct | undefined {
  if (!selectedNodeId) return undefined;
  if (index.document.graphId !== explorer.graphId) {
    throw new Error("Repository Audit visual explorer impact index must match the explorer graph.");
  }

  const selectedNode = explorer.nodes.find((node) => node.id === selectedNodeId);
  if (!selectedNode) return undefined;
  if (!index.nodesById.has(selectedNodeId)) {
    throw new Error("Repository Audit selected explorer node is missing from the impact index.");
  }

  return createSolveGraphImpactQueryProduct(index, {
    changedNodeIds: [selectedNodeId],
    query: {
      maxDepth: options.maxDepth ?? 6,
      maxResults: options.maxResults ?? 200,
    },
    presentation: {
      maxRows: options.maxRows ?? 40,
    },
  });
}
