import type {
  SolveGraphDocument,
  SolveGraphEdgeKind,
  SolveGraphNode,
  SolveGraphNodeKind,
} from "../../solve-graph/core/contracts";
import { createSolveGraphQueryIndex } from "../../solve-graph/core/query-impact";

export type RepositoryAuditVisualExplorerNode = {
  id: string;
  kind: SolveGraphNodeKind;
  label: string;
  path?: string;
  incoming: number;
  outgoing: number;
};

export type RepositoryAuditVisualExplorerEdge = {
  id: string;
  kind: SolveGraphEdgeKind;
  from: string;
  to: string;
};

export type RepositoryAuditVisualExplorer = {
  schema: "solvelang.repository-audit.visual-explorer.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  nodes: RepositoryAuditVisualExplorerNode[];
  edges: RepositoryAuditVisualExplorerEdge[];
  summary: {
    nodesObserved: number;
    nodesShown: number;
    nodesHidden: number;
    edgesObserved: number;
    edgesShown: number;
    edgesHidden: number;
    securityBoundaryNodesShown: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxNodes: number;
    maxEdges: number;
    nodesTruncated: boolean;
    edgesTruncated: boolean;
    graphPartial: boolean;
  };
};

export type RepositoryAuditVisualExplorerOptions = {
  maxNodes?: number;
  maxEdges?: number;
};

const kindPriority: Record<SolveGraphNodeKind, number> = {
  route: 0,
  workflow: 1,
  job: 2,
  permission: 3,
  resource: 4,
  function: 5,
  dependency: 6,
  test: 7,
  module: 8,
  class: 9,
  type: 10,
  symbol: 11,
  file: 12,
  document: 13,
  directory: 14,
  repository: 15,
};

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safePath(node: SolveGraphNode): string | undefined {
  const metadataPath = node.metadata?.path;
  if (typeof metadataPath === "string" && metadataPath.length > 0) return metadataPath;
  return node.evidence[0]?.path;
}

function compareNodes(left: SolveGraphNode, right: SolveGraphNode): number {
  return kindPriority[left.kind] - kindPriority[right.kind]
    || compareText(left.label, right.label)
    || compareText(left.id, right.id);
}

export async function createRepositoryAuditVisualExplorer(
  graph: SolveGraphDocument,
  options: RepositoryAuditVisualExplorerOptions = {},
): Promise<RepositoryAuditVisualExplorer> {
  const maxNodes = boundedInteger(options.maxNodes, 300, 1, 2_000, "Repository Audit visual explorer maxNodes");
  const maxEdges = boundedInteger(options.maxEdges, 600, 1, 5_000, "Repository Audit visual explorer maxEdges");
  const index = await createSolveGraphQueryIndex(graph);

  const orderedNodes = [...graph.nodes].sort(compareNodes);
  const selectedNodes = orderedNodes.slice(0, maxNodes);
  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const candidateEdges = graph.edges
    .filter((edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to))
    .sort((left, right) => compareText(left.kind, right.kind) || compareText(left.id, right.id));
  const edges = candidateEdges.slice(0, maxEdges).map((edge) => ({
    id: edge.id,
    kind: edge.kind,
    from: edge.from,
    to: edge.to,
  }));
  const nodes = selectedNodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    label: node.label,
    ...(safePath(node) === undefined ? {} : { path: safePath(node) }),
    incoming: index.incomingByNodeId.get(node.id)?.length ?? 0,
    outgoing: index.outgoingByNodeId.get(node.id)?.length ?? 0,
  }));
  const nodesTruncated = orderedNodes.length > maxNodes;
  const edgesTruncated = candidateEdges.length > maxEdges;
  const graphPartial = graph.execution.status === "partial" || graph.execution.truncated;

  return {
    schema: "solvelang.repository-audit.visual-explorer.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: graphPartial || nodesTruncated || edgesTruncated ? "partial" : "complete",
    nodes,
    edges,
    summary: {
      nodesObserved: graph.nodes.length,
      nodesShown: nodes.length,
      nodesHidden: Math.max(0, graph.nodes.length - nodes.length),
      edgesObserved: graph.edges.length,
      edgesShown: edges.length,
      edgesHidden: Math.max(0, graph.edges.length - edges.length),
      securityBoundaryNodesShown: nodes.filter((node) => node.kind === "permission" || node.kind === "resource").length,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxNodes,
      maxEdges,
      nodesTruncated,
      edgesTruncated,
      graphPartial,
    },
  };
}
