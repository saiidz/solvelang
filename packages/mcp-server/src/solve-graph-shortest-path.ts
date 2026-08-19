import {
  SOLVE_GRAPH_TOOL_API_VERSION,
  solveGraphEdgeKinds,
  type SolveGraphDocument,
  type SolveGraphEdge,
  type SolveGraphEdgeKind,
  type SolveGraphNode,
  type SolveGraphToolNode,
} from "./solve-graph.js";

export const MAX_SOLVE_GRAPH_SHORTEST_PATH_DEPTH = 64;
export const MAX_SOLVE_GRAPH_SHORTEST_PATH_VISITED = 10_000;

export type SolveGraphShortestPathDirection = "dependencies" | "dependents";

export type SolveGraphShortestPathOptions = {
  direction?: SolveGraphShortestPathDirection;
  edgeKinds?: readonly SolveGraphEdgeKind[];
  maxDepth?: number;
  maxVisited?: number;
};

export type SolveGraphShortestPathResponse = {
  apiVersion: typeof SOLVE_GRAPH_TOOL_API_VERSION;
  tool: "solve_graph.shortest_path";
  graphId: string;
  direction: SolveGraphShortestPathDirection;
  sourceId: string;
  targetId: string;
  found: boolean;
  nodes: SolveGraphToolNode[];
  hops: Array<{
    edgeId: string;
    edgeKind: SolveGraphEdgeKind;
    edgeFromId: string;
    edgeToId: string;
    traversalFromId: string;
    traversalToId: string;
  }>;
  visitedCount: number;
  truncated: boolean;
  truncationReason?: "depth" | "visited-count";
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxDepth: number;
    maxVisited: number;
  };
};

type QueueEntry = { id: string; depth: number };
type ParentEntry = { parentId: string; edge: SolveGraphEdge };
const edgeKindSet = new Set<string>(solveGraphEdgeKinds);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function normalizeEdgeKinds(values: readonly SolveGraphEdgeKind[] | undefined): Set<SolveGraphEdgeKind> | undefined {
  if (values === undefined) return undefined;
  const result = new Set<SolveGraphEdgeKind>();
  for (const value of values) {
    if (!edgeKindSet.has(value)) throw new Error(`Solve Graph shortest-path edge kind is invalid: ${value}`);
    result.add(value);
  }
  return result;
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

function neighborForDirection(edge: SolveGraphEdge, direction: SolveGraphShortestPathDirection): string {
  return direction === "dependencies" ? edge.to : edge.from;
}

function buildAdjacency(document: SolveGraphDocument, direction: SolveGraphShortestPathDirection): Map<string, SolveGraphEdge[]> {
  const adjacency = new Map(document.nodes.map((node) => [node.id, [] as SolveGraphEdge[]]));
  for (const edge of document.edges) {
    const key = direction === "dependencies" ? edge.from : edge.to;
    adjacency.get(key)?.push(edge);
  }
  for (const edges of adjacency.values()) edges.sort((left, right) => compareText(left.id, right.id));
  return adjacency;
}

function reconstruct(
  document: SolveGraphDocument,
  sourceId: string,
  targetId: string,
  parents: ReadonlyMap<string, ParentEntry>,
): Pick<SolveGraphShortestPathResponse, "nodes" | "hops"> {
  const reversedNodeIds = [targetId];
  const reversedParents: Array<{ childId: string; parent: ParentEntry }> = [];
  let currentId = targetId;

  while (currentId !== sourceId) {
    const parent = parents.get(currentId);
    if (!parent) throw new Error("Solve Graph shortest-path reconstruction failed.");
    reversedParents.push({ childId: currentId, parent });
    reversedNodeIds.push(parent.parentId);
    currentId = parent.parentId;
  }

  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const nodeIds = reversedNodeIds.reverse();
  return {
    nodes: nodeIds.map((id) => safeNode(nodesById.get(id)!)),
    hops: reversedParents.reverse().map(({ childId, parent }) => ({
      edgeId: parent.edge.id,
      edgeKind: parent.edge.kind,
      edgeFromId: parent.edge.from,
      edgeToId: parent.edge.to,
      traversalFromId: parent.parentId,
      traversalToId: childId,
    })),
  };
}

function baseResponse(
  document: SolveGraphDocument,
  sourceId: string,
  targetId: string,
  direction: SolveGraphShortestPathDirection,
  maxDepth: number,
  maxVisited: number,
) {
  return {
    apiVersion: SOLVE_GRAPH_TOOL_API_VERSION,
    tool: "solve_graph.shortest_path" as const,
    graphId: document.graphId,
    direction,
    sourceId,
    targetId,
    execution: {
      networkAccess: false as const,
      writeAccess: false as const,
      maxDepth,
      maxVisited,
    },
  };
}

export function findSolveGraphShortestPath(
  document: SolveGraphDocument,
  sourceId: string,
  targetId: string,
  options: SolveGraphShortestPathOptions = {},
): SolveGraphShortestPathResponse {
  if (document.mode !== "analyze-only" || document.execution.networkAccess !== false || document.execution.writeAccess !== false) {
    throw new Error("Solve Graph shortest path requires an analyze-only document with networkAccess=false and writeAccess=false.");
  }
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  if (!nodesById.has(sourceId)) throw new Error(`Solve Graph shortest-path source does not exist: ${sourceId}`);
  if (!nodesById.has(targetId)) throw new Error(`Solve Graph shortest-path target does not exist: ${targetId}`);

  const direction = options.direction ?? "dependencies";
  if (direction !== "dependencies" && direction !== "dependents") {
    throw new Error(`Solve Graph shortest-path direction is invalid: ${String(direction)}`);
  }
  const edgeKinds = normalizeEdgeKinds(options.edgeKinds);
  const maxDepth = boundedInteger(options.maxDepth, 8, 0, MAX_SOLVE_GRAPH_SHORTEST_PATH_DEPTH, "Solve Graph shortest-path maxDepth");
  const maxVisited = boundedInteger(options.maxVisited, 1_000, 1, MAX_SOLVE_GRAPH_SHORTEST_PATH_VISITED, "Solve Graph shortest-path maxVisited");
  const response = baseResponse(document, sourceId, targetId, direction, maxDepth, maxVisited);

  if (sourceId === targetId) {
    return {
      ...response,
      found: true,
      nodes: [safeNode(nodesById.get(sourceId)!)],
      hops: [],
      visitedCount: 1,
      truncated: false,
    };
  }

  const adjacency = buildAdjacency(document, direction);
  const queue: QueueEntry[] = [{ id: sourceId, depth: 0 }];
  const visited = new Set<string>([sourceId]);
  const parents = new Map<string, ParentEntry>();
  let depthBoundaryReached = false;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const candidateEdges = (adjacency.get(current.id) ?? []).filter((edge) => !edgeKinds || edgeKinds.has(edge.kind));

    if (current.depth >= maxDepth) {
      if (candidateEdges.some((edge) => !visited.has(neighborForDirection(edge, direction)))) depthBoundaryReached = true;
      continue;
    }

    for (const edge of candidateEdges) {
      const neighborId = neighborForDirection(edge, direction);
      if (visited.has(neighborId)) continue;
      if (visited.size >= maxVisited) {
        return {
          ...response,
          found: false,
          nodes: [],
          hops: [],
          visitedCount: visited.size,
          truncated: true,
          truncationReason: "visited-count",
        };
      }
      visited.add(neighborId);
      parents.set(neighborId, { parentId: current.id, edge });
      if (neighborId === targetId) {
        return {
          ...response,
          found: true,
          ...reconstruct(document, sourceId, targetId, parents),
          visitedCount: visited.size,
          truncated: false,
        };
      }
      queue.push({ id: neighborId, depth: current.depth + 1 });
    }
  }

  return {
    ...response,
    found: false,
    nodes: [],
    hops: [],
    visitedCount: visited.size,
    truncated: depthBoundaryReached,
    ...(depthBoundaryReached ? { truncationReason: "depth" as const } : {}),
  };
}
