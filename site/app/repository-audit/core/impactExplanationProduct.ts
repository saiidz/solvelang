import {
  createSolveGraphImpactExplanation,
  type SolveGraphImpactExplanation,
} from "../../solve-graph/core/impact-explanation";
import {
  analyzeSolveGraphImpact,
  type SolveGraphQueryIndex,
} from "../../solve-graph/core/query-impact";

export type RepositoryAuditImpactExplanationProduct = {
  schema: "solvelang.repository-audit.impact-explanation-product.v0";
  mode: "analyze-only";
  graphId: string;
  selectedNode: {
    id: string;
    kind: string;
    label: string;
  };
  explanation: SolveGraphImpactExplanation;
  execution: {
    networkAccess: false;
    writeAccess: false;
  };
};

export type RepositoryAuditImpactExplanationProductOptions = {
  maxDepth?: number;
  maxResults?: number;
  maxRows?: number;
};

export function createRepositoryAuditImpactExplanationProduct(
  index: SolveGraphQueryIndex,
  selectedNodeId: string,
  options: RepositoryAuditImpactExplanationProductOptions = {},
): RepositoryAuditImpactExplanationProduct {
  const selectedNode = index.nodesById.get(selectedNodeId);
  if (!selectedNode) {
    throw new Error(`Repository Audit impact explanation selected node does not exist: ${selectedNodeId}`);
  }

  const traversal = analyzeSolveGraphImpact(index, [selectedNodeId], {
    maxDepth: options.maxDepth ?? 8,
    maxResults: options.maxResults ?? 1_000,
  });
  const explanation = createSolveGraphImpactExplanation(index, traversal, {
    maxRows: options.maxRows ?? 100,
  });

  return {
    schema: "solvelang.repository-audit.impact-explanation-product.v0",
    mode: "analyze-only",
    graphId: index.document.graphId,
    selectedNode: {
      id: selectedNode.id,
      kind: selectedNode.kind,
      label: selectedNode.label,
    },
    explanation,
    execution: {
      networkAccess: false,
      writeAccess: false,
    },
  };
}
