import type { SolveGraphAlternativePath, SolveGraphAlternativePathsResult } from "./alternative-paths";
import type { SolveGraphNode } from "./contracts";
import type { SolveGraphQueryIndex } from "./query-impact";

export type SolveGraphAlternativePathPresentationNode = {
  id: string;
  kind: SolveGraphNode["kind"];
  label: string;
  path?: string;
};

export type SolveGraphAlternativePathPresentationRow = {
  pathIndex: number;
  hopCount: number;
  nodes: SolveGraphAlternativePathPresentationNode[];
  hops: SolveGraphAlternativePath["hops"];
};

export type SolveGraphAlternativePathsPresentation = {
  schema: "solvelang.solve-graph.alternative-paths-presentation.v0";
  mode: "analyze-only";
  graphId: string;
  direction: SolveGraphAlternativePathsResult["direction"];
  sourceId: string;
  targetId: string;
  status: "complete" | "partial";
  rows: SolveGraphAlternativePathPresentationRow[];
  notices: string[];
  summary: {
    availablePaths: number;
    shownPaths: number;
    hiddenPaths: number;
    minimumHops?: number;
    maximumHops?: number;
    statesCreated: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxPaths: number;
    queryTruncated: boolean;
    presentationTruncated: boolean;
  };
};

export type SolveGraphAlternativePathsPresentationOptions = {
  maxPaths?: number;
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function assertResult(index: SolveGraphQueryIndex, result: SolveGraphAlternativePathsResult): void {
  if (!index.nodesById.has(result.sourceId) || !index.nodesById.has(result.targetId)) {
    throw new Error("Solve Graph alternative-path presentation requires query endpoints from the same graph.");
  }
  if (result.direction !== "dependencies" && result.direction !== "dependents") {
    throw new Error("Solve Graph alternative-path presentation direction is invalid.");
  }
  if (result.truncationReason !== undefined
    && result.truncationReason !== "depth"
    && result.truncationReason !== "path-count"
    && result.truncationReason !== "state-count") {
    throw new Error("Solve Graph alternative-path presentation truncation reason is invalid.");
  }
  if (result.truncated !== (result.truncationReason !== undefined)) {
    throw new Error("Solve Graph alternative-path presentation truncation metadata is inconsistent.");
  }
  const edgesById = new Map(index.document.edges.map((edge) => [edge.id, edge] as const));
  for (const path of result.paths) {
    if (path.nodeIds.length !== path.hops.length + 1 || path.nodeIds.length === 0) {
      throw new Error("Solve Graph alternative-path presentation path shape is invalid.");
    }
    if (path.nodeIds[0] !== result.sourceId || path.nodeIds[path.nodeIds.length - 1] !== result.targetId) {
      throw new Error("Solve Graph alternative-path presentation path endpoints are invalid.");
    }
    path.nodeIds.forEach((nodeId) => {
      if (!index.nodesById.has(nodeId)) throw new Error("Solve Graph alternative-path presentation references a missing node.");
    });
    path.hops.forEach((hop, hopIndex) => {
      if (hop.from !== path.nodeIds[hopIndex] || hop.to !== path.nodeIds[hopIndex + 1]) {
        throw new Error("Solve Graph alternative-path presentation hop orientation is invalid.");
      }
      const edge = edgesById.get(hop.edgeId);
      if (!edge || edge.kind !== hop.edgeKind) {
        throw new Error("Solve Graph alternative-path presentation references a missing or mismatched edge.");
      }
      const oriented = result.direction === "dependencies"
        ? edge.from === hop.from && edge.to === hop.to
        : edge.to === hop.from && edge.from === hop.to;
      if (!oriented) throw new Error("Solve Graph alternative-path presentation edge traversal is invalid.");
    });
  }
}

function presentNode(node: SolveGraphNode): SolveGraphAlternativePathPresentationNode {
  const metadataPath = node.metadata?.path;
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    ...(typeof metadataPath === "string" && metadataPath.length > 0 ? { path: metadataPath } : {}),
  };
}

function noticeForQueryTruncation(reason: SolveGraphAlternativePathsResult["truncationReason"]): string | undefined {
  switch (reason) {
    case "depth":
      return "Alternative-path enumeration reached the configured depth bound; additional paths may exist.";
    case "path-count":
      return "Alternative-path enumeration reached the configured path-count bound; additional paths may exist.";
    case "state-count":
      return "Alternative-path enumeration reached the configured traversal-state bound; additional paths may exist.";
    default:
      return undefined;
  }
}

export function createSolveGraphAlternativePathsPresentation(
  index: SolveGraphQueryIndex,
  result: SolveGraphAlternativePathsResult,
  options: SolveGraphAlternativePathsPresentationOptions = {},
): SolveGraphAlternativePathsPresentation {
  assertResult(index, result);
  const maxPaths = boundedInteger(options.maxPaths, 8, 1, 64, "Solve Graph alternative-path presentation maxPaths");
  const presentationTruncated = result.paths.length > maxPaths;
  const visiblePaths = result.paths.slice(0, maxPaths);
  const rows = visiblePaths.map((path, pathIndex) => ({
    pathIndex,
    hopCount: path.hops.length,
    nodes: path.nodeIds.map((nodeId) => presentNode(index.nodesById.get(nodeId)!)),
    hops: path.hops.map((hop) => ({ ...hop })),
  }));
  const notices: string[] = [];
  const queryNotice = noticeForQueryTruncation(result.truncationReason);
  if (queryNotice) notices.push(queryNotice);
  if (presentationTruncated) {
    notices.push("This presentation shows only the first bounded subset of paths returned by the query.");
  }
  const hopCounts = result.paths.map((path) => path.hops.length);
  const partial = result.truncated || presentationTruncated;

  return {
    schema: "solvelang.solve-graph.alternative-paths-presentation.v0",
    mode: "analyze-only",
    graphId: index.document.graphId,
    direction: result.direction,
    sourceId: result.sourceId,
    targetId: result.targetId,
    status: partial ? "partial" : "complete",
    rows,
    notices,
    summary: {
      availablePaths: result.paths.length,
      shownPaths: rows.length,
      hiddenPaths: Math.max(0, result.paths.length - rows.length),
      ...(hopCounts.length === 0 ? {} : {
        minimumHops: Math.min(...hopCounts),
        maximumHops: Math.max(...hopCounts),
      }),
      statesCreated: result.statesCreated,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxPaths,
      queryTruncated: result.truncated,
      presentationTruncated,
    },
  };
}
