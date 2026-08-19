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
