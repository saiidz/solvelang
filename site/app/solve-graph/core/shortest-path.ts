import {
  solveGraphEdgeKinds,
  type SolveGraphEdge,
  type SolveGraphEdgeKind,
} from "./contracts";
import {
  defaultSolveGraphQueryLimits,
  type SolveGraphQueryIndex,
  type SolveGraphTraversalDirection,
} from "./query-impact";

const HARD_MAX_DEPTH = 64;
const HARD_MAX_VISITED = 10_000;
const edgeKindSet = new Set<string>(solveGraphEdgeKinds);

export type SolveGraphShortestPathOptions = {
  direction?: SolveGraphTraversalDirection;
  edgeKinds?: readonly SolveGraphEdgeKind[];
  maxDepth?: number;
  maxVisited?: number;
};

export type SolveGraphShortestPathHop = {
  edgeId: string;
  edgeKind: SolveGraphEdgeKind;
  from: string;
  to: string;
};

export type SolveGraphShortestPathResult = {
  direction: SolveGraphTraversalDirection;
  sourceId: string;
  targetId: string;
  found: boolean;
  nodeIds: string[];
  hops: SolveGraphShortestPathHop[];
  visitedCount: number;
  truncated: boolean;
  truncationReason?: "depth" | "visited-count";
};

type QueueEntry = { id: string; depth: number };
type ParentEntry = { parentId: string; edge: SolveGraphEdge };

function boundedDepth(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > HARD_MAX_DEPTH) {
    throw new Error(`Solve Graph shortest-path maxDepth must be an integer from 0 through ${HARD_MAX_DEPTH}.`);
  }
  return value;
}

function boundedVisited(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > HARD_MAX_VISITED) {
    throw new Error(`Solve Graph shortest-path maxVisited must be an integer from 1 through ${HARD_MAX_VISITED}.`);
  }
  return value;
}

function normalizeEdgeKinds(values: readonly SolveGraphEdgeKind[] | undefined): Set<SolveGraphEdgeKind> | undefined {
  if (values === undefined) return undefined;
  const normalized = new Set<SolveGraphEdgeKind>();
  for (const value of values) {
    if (!edgeKindSet.has(value)) throw new Error(`Solve Graph edge kind is invalid: ${value}`);
    normalized.add(value);
  }
  return normalized;
}

function edgesForDirection(
  index: SolveGraphQueryIndex,
  id: string,
  direction: SolveGraphTraversalDirection,
): readonly SolveGraphEdge[] {
  return direction === "dependencies"
    ? (index.outgoingByNodeId.get(id) ?? [])
    : (index.incomingByNodeId.get(id) ?? []);
}

function neighborForDirection(edge: SolveGraphEdge, direction: SolveGraphTraversalDirection): string {
  return direction === "dependencies" ? edge.to : edge.from;
}

function reconstructPath(
  sourceId: string,
  targetId: string,
  parents: ReadonlyMap<string, ParentEntry>,
): { nodeIds: string[]; hops: SolveGraphShortestPathHop[] } {
  const reversedNodes = [targetId];
  const reversedHops: SolveGraphShortestPathHop[] = [];
  let currentId = targetId;

  while (currentId !== sourceId) {
    const parent = parents.get(currentId);
    if (!parent) throw new Error("Solve Graph shortest-path reconstruction failed.");
    reversedNodes.push(parent.parentId);
    reversedHops.push({
      edgeId: parent.edge.id,
      edgeKind: parent.edge.kind,
      from: parent.parentId,
      to: currentId,
    });
    currentId = parent.parentId;
  }

  return {
    nodeIds: reversedNodes.reverse(),
    hops: reversedHops.reverse(),
  };
}

export function findSolveGraphShortestPath(
  index: SolveGraphQueryIndex,
  sourceId: string,
  targetId: string,
  options: SolveGraphShortestPathOptions = {},
): SolveGraphShortestPathResult {
  if (!index.nodesById.has(sourceId)) throw new Error(`Solve Graph shortest-path source does not exist: ${sourceId}`);
  if (!index.nodesById.has(targetId)) throw new Error(`Solve Graph shortest-path target does not exist: ${targetId}`);

  const direction = options.direction ?? "dependencies";
  if (direction !== "dependencies" && direction !== "dependents") {
    throw new Error(`Solve Graph shortest-path direction is invalid: ${String(direction)}`);
  }

  const edgeKinds = normalizeEdgeKinds(options.edgeKinds);
  const maxDepth = boundedDepth(options.maxDepth ?? defaultSolveGraphQueryLimits.maxDepth);
  const maxVisited = boundedVisited(options.maxVisited ?? defaultSolveGraphQueryLimits.maxResults);

  if (sourceId === targetId) {
    return {
      direction,
      sourceId,
      targetId,
      found: true,
      nodeIds: [sourceId],
      hops: [],
      visitedCount: 1,
      truncated: false,
    };
  }

  const queue: QueueEntry[] = [{ id: sourceId, depth: 0 }];
  const visited = new Set<string>([sourceId]);
  const parents = new Map<string, ParentEntry>();
  let depthBoundaryReached = false;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const candidateEdges = edgesForDirection(index, current.id, direction)
      .filter((edge) => !edgeKinds || edgeKinds.has(edge.kind));

    if (current.depth >= maxDepth) {
      if (candidateEdges.some((edge) => !visited.has(neighborForDirection(edge, direction)))) {
        depthBoundaryReached = true;
      }
      continue;
    }

    for (const edge of candidateEdges) {
      const neighborId = neighborForDirection(edge, direction);
      if (visited.has(neighborId)) continue;
      if (visited.size >= maxVisited) {
        return {
          direction,
          sourceId,
          targetId,
          found: false,
          nodeIds: [],
          hops: [],
          visitedCount: visited.size,
          truncated: true,
          truncationReason: "visited-count",
        };
      }

      visited.add(neighborId);
      parents.set(neighborId, { parentId: current.id, edge });
      if (neighborId === targetId) {
        const path = reconstructPath(sourceId, targetId, parents);
        return {
          direction,
          sourceId,
          targetId,
          found: true,
          ...path,
          visitedCount: visited.size,
          truncated: false,
        };
      }
      queue.push({ id: neighborId, depth: current.depth + 1 });
    }
  }

  return {
    direction,
    sourceId,
    targetId,
    found: false,
    nodeIds: [],
    hops: [],
    visitedCount: visited.size,
    truncated: depthBoundaryReached,
    ...(depthBoundaryReached ? { truncationReason: "depth" as const } : {}),
  };
}
