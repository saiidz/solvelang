import {
  SOLVE_GRAPH_TOOL_API_VERSION,
  solveGraphEdgeKinds,
  type SolveGraphDocument,
  type SolveGraphEdge,
  type SolveGraphEdgeKind,
  type SolveGraphNode,
  type SolveGraphToolNode,
} from "./solve-graph.js";

export const MAX_SOLVE_GRAPH_ALTERNATIVE_PATH_DEPTH = 32;
export const MAX_SOLVE_GRAPH_ALTERNATIVE_PATHS = 32;
export const MAX_SOLVE_GRAPH_ALTERNATIVE_PATH_STATES = 10_000;

export type SolveGraphAlternativePathDirection = "dependencies" | "dependents";

export type SolveGraphAlternativePathOptions = {
  direction?: SolveGraphAlternativePathDirection;
  edgeKinds?: readonly SolveGraphEdgeKind[];
  maxDepth?: number;
  maxPaths?: number;
  maxStates?: number;
};

export type SolveGraphAlternativePathHop = {
  edgeId: string;
  edgeKind: SolveGraphEdgeKind;
  edgeFromId: string;
  edgeToId: string;
  traversalFromId: string;
  traversalToId: string;
};

export type SolveGraphAlternativePath = {
  nodes: SolveGraphToolNode[];
  hops: SolveGraphAlternativePathHop[];
};

export type SolveGraphAlternativePathsResponse = {
  apiVersion: typeof SOLVE_GRAPH_TOOL_API_VERSION;
  tool: "solve_graph.alternative_paths";
  graphId: string;
  direction: SolveGraphAlternativePathDirection;
  sourceId: string;
  targetId: string;
  paths: SolveGraphAlternativePath[];
  statesCreated: number;
  truncated: boolean;
  truncationReason?: "depth" | "path-count" | "state-count";
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxDepth: number;
    maxPaths: number;
    maxStates: number;
  };
};

export type SolveGraphAlternativePathExplanationStep = {
  index: number;
  edgeId: string;
  edgeKind: SolveGraphEdgeKind;
  from: SolveGraphToolNode;
  to: SolveGraphToolNode;
  sentence: string;
};

export type SolveGraphAlternativePathExplanation = {
  index: number;
  hopCount: number;
  nodes: SolveGraphToolNode[];
  steps: SolveGraphAlternativePathExplanationStep[];
};

export type SolveGraphAlternativePathsExplanation = {
  schema: "solvelang.mcp.solve-graph.alternative-paths-explanation.v0";
  mode: "analyze-only";
  graphId: string;
  direction: SolveGraphAlternativePathDirection;
  sourceId: string;
  targetId: string;
  status: "complete" | "partial";
  headline: string;
  detail: string;
  paths: SolveGraphAlternativePathExplanation[];
  notices: string[];
  summary: {
    pathCount: number;
    shortestHopCount: number | null;
    longestHopCount: number | null;
    statesCreated: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    queryTruncated: boolean;
    maxDepth: number;
    maxPaths: number;
    maxStates: number;
  };
};

type PathState = {
  nodeIds: string[];
  hops: SolveGraphAlternativePathHop[];
  depth: number;
};

const edgeKindSet = new Set<string>(solveGraphEdgeKinds);

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeEdgeKinds(values: readonly SolveGraphEdgeKind[] | undefined): Set<SolveGraphEdgeKind> | undefined {
  if (values === undefined) return undefined;
  const normalized = new Set<SolveGraphEdgeKind>();
  for (const value of values) {
    if (!edgeKindSet.has(value)) throw new Error(`Solve Graph alternative-path edge kind is invalid: ${value}`);
    normalized.add(value);
  }
  return normalized;
}

function safeNode(node: SolveGraphNode): SolveGraphToolNode {
  const path = node.metadata?.path;
  const packageName = node.metadata?.packageName;
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    ...(typeof path === "string" ? { path } : {}),
    ...(typeof packageName === "string" ? { packageName } : {}),
  };
}

function copyToolNode(node: SolveGraphToolNode): SolveGraphToolNode {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    ...(typeof node.path === "string" ? { path: node.path } : {}),
    ...(typeof node.packageName === "string" ? { packageName: node.packageName } : {}),
  };
}

function neighborForDirection(edge: SolveGraphEdge, direction: SolveGraphAlternativePathDirection): string {
  return direction === "dependencies" ? edge.to : edge.from;
}

function buildAdjacency(document: SolveGraphDocument, direction: SolveGraphAlternativePathDirection): Map<string, SolveGraphEdge[]> {
  const adjacency = new Map(document.nodes.map((node) => [node.id, [] as SolveGraphEdge[]]));
  for (const edge of document.edges) {
    const key = direction === "dependencies" ? edge.from : edge.to;
    adjacency.get(key)?.push(edge);
  }
  for (const edges of adjacency.values()) edges.sort((left, right) => compareText(left.id, right.id));
  return adjacency;
}

function pathSortKey(path: SolveGraphAlternativePath): string {
  return `${path.nodes.map((node) => node.id).join("\u001f")}\u001e${path.hops.map((hop) => hop.edgeId).join("\u001f")}`;
}

function sortPaths(paths: readonly SolveGraphAlternativePath[]): SolveGraphAlternativePath[] {
  return [...paths].sort((left, right) => left.hops.length - right.hops.length
    || compareText(pathSortKey(left), pathSortKey(right)));
}

function baseResponse(
  document: SolveGraphDocument,
  sourceId: string,
  targetId: string,
  direction: SolveGraphAlternativePathDirection,
  maxDepth: number,
  maxPaths: number,
  maxStates: number,
) {
  return {
    apiVersion: SOLVE_GRAPH_TOOL_API_VERSION,
    tool: "solve_graph.alternative_paths" as const,
    graphId: document.graphId,
    direction,
    sourceId,
    targetId,
    execution: {
      networkAccess: false as const,
      writeAccess: false as const,
      maxDepth,
      maxPaths,
      maxStates,
    },
  };
}

function materializePath(nodesById: ReadonlyMap<string, SolveGraphNode>, state: PathState): SolveGraphAlternativePath {
  return {
    nodes: state.nodeIds.map((id) => safeNode(nodesById.get(id)!)),
    hops: state.hops.map((hop) => ({ ...hop })),
  };
}

function response(
  base: ReturnType<typeof baseResponse>,
  paths: readonly SolveGraphAlternativePath[],
  statesCreated: number,
  truncated: boolean,
  truncationReason?: SolveGraphAlternativePathsResponse["truncationReason"],
): SolveGraphAlternativePathsResponse {
  return {
    ...base,
    paths: sortPaths(paths),
    statesCreated,
    truncated,
    ...(truncationReason ? { truncationReason } : {}),
  };
}

export function findSolveGraphAlternativePaths(
  document: SolveGraphDocument,
  sourceId: string,
  targetId: string,
  options: SolveGraphAlternativePathOptions = {},
): SolveGraphAlternativePathsResponse {
  if (document.mode !== "analyze-only" || document.execution.networkAccess !== false || document.execution.writeAccess !== false) {
    throw new Error("Solve Graph alternative paths require an analyze-only document with networkAccess=false and writeAccess=false.");
  }
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  if (!nodesById.has(sourceId)) throw new Error(`Solve Graph alternative-path source does not exist: ${sourceId}`);
  if (!nodesById.has(targetId)) throw new Error(`Solve Graph alternative-path target does not exist: ${targetId}`);

  const direction = options.direction ?? "dependencies";
  if (direction !== "dependencies" && direction !== "dependents") {
    throw new Error(`Solve Graph alternative-path direction is invalid: ${String(direction)}`);
  }
  const edgeKinds = normalizeEdgeKinds(options.edgeKinds);
  const maxDepth = boundedInteger(options.maxDepth, 8, 0, MAX_SOLVE_GRAPH_ALTERNATIVE_PATH_DEPTH, "Solve Graph alternative-path maxDepth");
  const maxPaths = boundedInteger(options.maxPaths, 8, 1, MAX_SOLVE_GRAPH_ALTERNATIVE_PATHS, "Solve Graph alternative-path maxPaths");
  const maxStates = boundedInteger(options.maxStates, 2_000, 1, MAX_SOLVE_GRAPH_ALTERNATIVE_PATH_STATES, "Solve Graph alternative-path maxStates");
  const base = baseResponse(document, sourceId, targetId, direction, maxDepth, maxPaths, maxStates);

  if (sourceId === targetId) {
    return response(base, [{ nodes: [safeNode(nodesById.get(sourceId)!)], hops: [] }], 1, false);
  }

  const adjacency = buildAdjacency(document, direction);
  const queue: PathState[] = [{ nodeIds: [sourceId], hops: [], depth: 0 }];
  let queueIndex = 0;
  const paths: SolveGraphAlternativePath[] = [];
  let statesCreated = 1;
  let depthBoundaryReached = false;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex++]!;
    const currentId = current.nodeIds[current.nodeIds.length - 1];
    const candidateEdges = (adjacency.get(currentId) ?? []).filter((edge) => !edgeKinds || edgeKinds.has(edge.kind));

    if (current.depth >= maxDepth) {
      if (candidateEdges.some((edge) => !current.nodeIds.includes(neighborForDirection(edge, direction)))) {
        depthBoundaryReached = true;
      }
      continue;
    }

    for (let edgeIndex = 0; edgeIndex < candidateEdges.length; edgeIndex += 1) {
      const edge = candidateEdges[edgeIndex];
      const neighborId = neighborForDirection(edge, direction);
      if (current.nodeIds.includes(neighborId)) continue;

      if (statesCreated >= maxStates) {
        return response(base, paths, statesCreated, true, "state-count");
      }
      statesCreated += 1;

      const next: PathState = {
        nodeIds: [...current.nodeIds, neighborId],
        hops: [...current.hops, {
          edgeId: edge.id,
          edgeKind: edge.kind,
          edgeFromId: edge.from,
          edgeToId: edge.to,
          traversalFromId: currentId,
          traversalToId: neighborId,
        }],
        depth: current.depth + 1,
      };

      if (neighborId === targetId) {
        paths.push(materializePath(nodesById, next));
        if (paths.length >= maxPaths) {
          const remainingSibling = candidateEdges
            .slice(edgeIndex + 1)
            .some((candidate) => !current.nodeIds.includes(neighborForDirection(candidate, direction)));
          if (remainingSibling || queueIndex < queue.length) {
            return response(base, paths, statesCreated, true, "path-count");
          }
        }
        continue;
      }
      queue.push(next);
    }
  }

  return response(
    base,
    paths,
    statesCreated,
    depthBoundaryReached,
    depthBoundaryReached ? "depth" : undefined,
  );
}

function validateExplanationResponse(response: SolveGraphAlternativePathsResponse): void {
  if (response.tool !== "solve_graph.alternative_paths") {
    throw new Error("Solve Graph alternative-path explanation requires an alternative-path response.");
  }
  if (response.execution.networkAccess !== false || response.execution.writeAccess !== false) {
    throw new Error("Solve Graph alternative-path explanation requires capability-free input.");
  }
  if (!Number.isSafeInteger(response.execution.maxDepth)
    || response.execution.maxDepth < 0
    || response.execution.maxDepth > MAX_SOLVE_GRAPH_ALTERNATIVE_PATH_DEPTH
    || !Number.isSafeInteger(response.execution.maxPaths)
    || response.execution.maxPaths < 1
    || response.execution.maxPaths > MAX_SOLVE_GRAPH_ALTERNATIVE_PATHS
    || !Number.isSafeInteger(response.execution.maxStates)
    || response.execution.maxStates < 1
    || response.execution.maxStates > MAX_SOLVE_GRAPH_ALTERNATIVE_PATH_STATES) {
    throw new Error("Solve Graph alternative-path explanation received invalid query bounds.");
  }
  if (!Number.isSafeInteger(response.statesCreated)
    || response.statesCreated < 1
    || response.statesCreated > response.execution.maxStates) {
    throw new Error("Solve Graph alternative-path explanation received invalid state-count truth.");
  }
  if (response.paths.length > response.execution.maxPaths) {
    throw new Error("Solve Graph alternative-path explanation received too many paths.");
  }
  if (response.truncated !== (response.truncationReason !== undefined)) {
    throw new Error("Solve Graph alternative-path explanation received inconsistent truncation truth.");
  }
  if (response.truncationReason !== undefined
    && response.truncationReason !== "depth"
    && response.truncationReason !== "path-count"
    && response.truncationReason !== "state-count") {
    throw new Error("Solve Graph alternative-path explanation received an invalid truncation reason.");
  }

  if (response.sourceId === response.targetId) {
    const [path] = response.paths;
    if (response.truncated || response.paths.length !== 1 || !path || path.nodes.length !== 1 || path.hops.length !== 0
      || path.nodes[0]!.id !== response.sourceId) {
      throw new Error("Solve Graph alternative-path explanation received invalid zero-hop truth.");
    }
  }

  for (const path of response.paths) {
    if (path.nodes.length === 0 || path.nodes.length !== path.hops.length + 1) {
      throw new Error("Solve Graph alternative-path explanation received an invalid path shape.");
    }
    if (path.hops.length > response.execution.maxDepth) {
      throw new Error("Solve Graph alternative-path explanation received a path outside the configured depth bound.");
    }
    if (path.nodes[0]!.id !== response.sourceId || path.nodes[path.nodes.length - 1]!.id !== response.targetId) {
      throw new Error("Solve Graph alternative-path explanation received invalid path endpoints.");
    }
    if (new Set(path.nodes.map((node) => node.id)).size !== path.nodes.length) {
      throw new Error("Solve Graph alternative-path explanation requires simple cycle-free paths.");
    }

    path.hops.forEach((hop, index) => {
      const from = path.nodes[index];
      const to = path.nodes[index + 1];
      if (!from || !to || hop.traversalFromId !== from.id || hop.traversalToId !== to.id) {
        throw new Error("Solve Graph alternative-path explanation received mismatched traversal evidence.");
      }
      const underlyingMatches = response.direction === "dependencies"
        ? hop.edgeFromId === from.id && hop.edgeToId === to.id
        : hop.edgeToId === from.id && hop.edgeFromId === to.id;
      if (!underlyingMatches) {
        throw new Error("Solve Graph alternative-path explanation received mismatched edge orientation.");
      }
    });
  }
}

function explanationHeadline(response: SolveGraphAlternativePathsResponse): string {
  if (response.sourceId === response.targetId) return "Source and target are the same node";
  if (response.paths.length > 0 && response.truncated) return "Alternative paths found; search incomplete";
  if (response.paths.length > 0) return "Alternative paths found";
  if (response.truncated) return "Alternative path search incomplete";
  return "No alternative path found";
}

function explanationDetail(response: SolveGraphAlternativePathsResponse): string {
  const pathCount = response.paths.length;
  const pathLabel = `${pathCount} path${pathCount === 1 ? "" : "s"}`;
  const stateLabel = `${response.statesCreated} search state${response.statesCreated === 1 ? "" : "s"}`;
  if (response.sourceId === response.targetId) {
    return `The query resolved immediately with one zero-hop path after creating ${stateLabel}.`;
  }
  if (pathCount > 0 && response.truncated) {
    return `Observed ${pathLabel} before the bounded search stopped after creating ${stateLabel}; additional paths may exist.`;
  }
  if (pathCount > 0) {
    return `Observed ${pathLabel} in the complete configured search after creating ${stateLabel}.`;
  }
  if (response.truncated) {
    return `No path was established before the bounded search stopped after creating ${stateLabel}; absence is not proven.`;
  }
  return `No path exists within the completely searched configured graph scope after creating ${stateLabel}.`;
}

function explanationNotices(response: SolveGraphAlternativePathsResponse): string[] {
  if (response.truncationReason === "depth") {
    return ["Alternative-path search reached the configured depth bound; additional paths may exist beyond the observed search depth."];
  }
  if (response.truncationReason === "path-count") {
    return ["Alternative-path search reached the configured path-count bound; additional paths may exist outside the returned set."];
  }
  if (response.truncationReason === "state-count") {
    return ["Alternative-path search reached the configured traversal-state bound; additional paths may exist outside the observed search states."];
  }
  if (response.paths.length === 0) {
    return ["No path was found within a complete search of the configured graph scope and edge filters."];
  }
  return [];
}

export function createSolveGraphAlternativePathsExplanation(
  response: SolveGraphAlternativePathsResponse,
): SolveGraphAlternativePathsExplanation {
  validateExplanationResponse(response);
  const hopCounts = response.paths.map((path) => path.hops.length);

  return {
    schema: "solvelang.mcp.solve-graph.alternative-paths-explanation.v0",
    mode: "analyze-only",
    graphId: response.graphId,
    direction: response.direction,
    sourceId: response.sourceId,
    targetId: response.targetId,
    status: response.truncated ? "partial" : "complete",
    headline: explanationHeadline(response),
    detail: explanationDetail(response),
    paths: response.paths.map((path, pathIndex) => ({
      index: pathIndex + 1,
      hopCount: path.hops.length,
      nodes: path.nodes.map(copyToolNode),
      steps: path.hops.map((hop, hopIndex) => {
        const from = copyToolNode(path.nodes[hopIndex]!);
        const to = copyToolNode(path.nodes[hopIndex + 1]!);
        return {
          index: hopIndex + 1,
          edgeId: hop.edgeId,
          edgeKind: hop.edgeKind,
          from,
          to,
          sentence: response.direction === "dependencies"
            ? `${from.label} --${hop.edgeKind}--> ${to.label}`
            : `${from.label} <--${hop.edgeKind}-- ${to.label}`,
        };
      }),
    })),
    notices: explanationNotices(response),
    summary: {
      pathCount: response.paths.length,
      shortestHopCount: hopCounts.length > 0 ? Math.min(...hopCounts) : null,
      longestHopCount: hopCounts.length > 0 ? Math.max(...hopCounts) : null,
      statesCreated: response.statesCreated,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      queryTruncated: response.truncated,
      maxDepth: response.execution.maxDepth,
      maxPaths: response.execution.maxPaths,
      maxStates: response.execution.maxStates,
    },
  };
}

export function explainSolveGraphAlternativePaths(
  document: SolveGraphDocument,
  sourceId: string,
  targetId: string,
  options: SolveGraphAlternativePathOptions = {},
): SolveGraphAlternativePathsExplanation {
  return createSolveGraphAlternativePathsExplanation(
    findSolveGraphAlternativePaths(document, sourceId, targetId, options),
  );
}
