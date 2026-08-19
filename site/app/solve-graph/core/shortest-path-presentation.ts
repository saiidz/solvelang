import type { SolveGraphNode } from "./contracts";
import type { SolveGraphQueryIndex } from "./query-impact";
import type { SolveGraphShortestPathResult } from "./shortest-path";

export type SolveGraphShortestPathPresentationNode = {
  id: string;
  kind: SolveGraphNode["kind"];
  label: string;
  path?: string;
};

export type SolveGraphShortestPathPresentation = {
  schema: "solvelang.solve-graph.shortest-path-presentation.v0";
  mode: "analyze-only";
  graphId: string;
  direction: SolveGraphShortestPathResult["direction"];
  sourceId: string;
  targetId: string;
  found: boolean;
  status: "complete" | "partial";
  nodes: SolveGraphShortestPathPresentationNode[];
  hops: SolveGraphShortestPathResult["hops"];
  notices: string[];
  summary: {
    hopCount: number;
    visitedCount: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    queryTruncated: boolean;
  };
};

function presentNode(node: SolveGraphNode): SolveGraphShortestPathPresentationNode {
  const metadataPath = node.metadata?.path;
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    ...(typeof metadataPath === "string" && metadataPath.length > 0 ? { path: metadataPath } : {}),
  };
}

function assertResult(index: SolveGraphQueryIndex, result: SolveGraphShortestPathResult): void {
  if (!index.nodesById.has(result.sourceId) || !index.nodesById.has(result.targetId)) {
    throw new Error("Solve Graph shortest-path presentation requires endpoints from the same graph.");
  }
  if (result.direction !== "dependencies" && result.direction !== "dependents") {
    throw new Error("Solve Graph shortest-path presentation direction is invalid.");
  }
  if (!Number.isSafeInteger(result.visitedCount) || result.visitedCount < 1 || result.visitedCount > 10_000) {
    throw new Error("Solve Graph shortest-path presentation visitedCount is invalid.");
  }
  if (result.truncationReason !== undefined
    && result.truncationReason !== "depth"
    && result.truncationReason !== "visited-count") {
    throw new Error("Solve Graph shortest-path presentation truncation reason is invalid.");
  }
  if (result.truncated !== (result.truncationReason !== undefined)) {
    throw new Error("Solve Graph shortest-path presentation truncation metadata is inconsistent.");
  }

  if (!result.found) {
    if (result.nodeIds.length !== 0 || result.hops.length !== 0) {
      throw new Error("Solve Graph shortest-path presentation must not contain a path when found=false.");
    }
    if (result.sourceId === result.targetId) {
      throw new Error("Solve Graph shortest-path presentation cannot report found=false for identical endpoints.");
    }
    return;
  }

  if (result.truncated) {
    throw new Error("Solve Graph shortest-path presentation cannot mark a found path as truncated.");
  }
  if (result.nodeIds.length !== result.hops.length + 1 || result.nodeIds.length === 0) {
    throw new Error("Solve Graph shortest-path presentation path shape is invalid.");
  }
  if (result.nodeIds[0] !== result.sourceId || result.nodeIds[result.nodeIds.length - 1] !== result.targetId) {
    throw new Error("Solve Graph shortest-path presentation path endpoints are invalid.");
  }
  if (new Set(result.nodeIds).size !== result.nodeIds.length) {
    throw new Error("Solve Graph shortest-path presentation path must be simple and cycle-free.");
  }

  const edgesById = new Map(index.document.edges.map((edge) => [edge.id, edge] as const));
  result.nodeIds.forEach((nodeId) => {
    if (!index.nodesById.has(nodeId)) throw new Error("Solve Graph shortest-path presentation references a missing node.");
  });
  result.hops.forEach((hop, hopIndex) => {
    if (hop.from !== result.nodeIds[hopIndex] || hop.to !== result.nodeIds[hopIndex + 1]) {
      throw new Error("Solve Graph shortest-path presentation hop orientation is invalid.");
    }
    const edge = edgesById.get(hop.edgeId);
    if (!edge || edge.kind !== hop.edgeKind) {
      throw new Error("Solve Graph shortest-path presentation references a missing or mismatched edge.");
    }
    const oriented = result.direction === "dependencies"
      ? edge.from === hop.from && edge.to === hop.to
      : edge.to === hop.from && edge.from === hop.to;
    if (!oriented) throw new Error("Solve Graph shortest-path presentation edge traversal is invalid.");
  });
}

function truncationNotice(reason: SolveGraphShortestPathResult["truncationReason"]): string | undefined {
  if (reason === "depth") {
    return "Shortest-path search reached the configured depth bound; a path may exist beyond the observed search depth.";
  }
  if (reason === "visited-count") {
    return "Shortest-path search reached the configured visited-node bound; a path may exist outside the observed search set.";
  }
  return undefined;
}

export function createSolveGraphShortestPathPresentation(
  index: SolveGraphQueryIndex,
  result: SolveGraphShortestPathResult,
): SolveGraphShortestPathPresentation {
  assertResult(index, result);
  const notices: string[] = [];
  const notice = truncationNotice(result.truncationReason);
  if (notice) notices.push(notice);
  if (!result.found && !result.truncated) {
    notices.push("No path was found within a complete search of the configured graph scope and edge filters.");
  }

  return {
    schema: "solvelang.solve-graph.shortest-path-presentation.v0",
    mode: "analyze-only",
    graphId: index.document.graphId,
    direction: result.direction,
    sourceId: result.sourceId,
    targetId: result.targetId,
    found: result.found,
    status: result.truncated ? "partial" : "complete",
    nodes: result.nodeIds.map((nodeId) => presentNode(index.nodesById.get(nodeId)!)),
    hops: result.hops.map((hop) => ({ ...hop })),
    notices,
    summary: {
      hopCount: result.hops.length,
      visitedCount: result.visitedCount,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      queryTruncated: result.truncated,
    },
  };
}
