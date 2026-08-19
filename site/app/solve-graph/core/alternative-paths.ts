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

const HARD_MAX_DEPTH = 32;
const HARD_MAX_PATHS = 64;
const HARD_MAX_STATES = 50_000;
const edgeKindSet = new Set<string>(solveGraphEdgeKinds);

export type SolveGraphAlternativePathsOptions = {
  direction?: SolveGraphTraversalDirection;
  edgeKinds?: readonly SolveGraphEdgeKind[];
  maxDepth?: number;
  maxPaths?: number;
  maxStates?: number;
};

export type SolveGraphAlternativePathHop = {
  edgeId: string;
  edgeKind: SolveGraphEdgeKind;
  from: string;
  to: string;
};

export type SolveGraphAlternativePath = {
  nodeIds: string[];
  hops: SolveGraphAlternativePathHop[];
};

export type SolveGraphAlternativePathsResult = {
  direction: SolveGraphTraversalDirection;
  sourceId: string;
  targetId: string;
  paths: SolveGraphAlternativePath[];
  statesCreated: number;
  truncated: boolean;
  truncationReason?: "depth" | "path-count" | "state-count";
};

type PathState = SolveGraphAlternativePath & { depth: number };

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedPaths(paths: readonly SolveGraphAlternativePath[]): SolveGraphAlternativePath[] {
  return [...paths].sort((left, right) => left.hops.length - right.hops.length
    || compareText(left.nodeIds.join("\u001f"), right.nodeIds.join("\u001f"))
    || compareText(left.hops.map((hop) => hop.edgeId).join("\u001f"), right.hops.map((hop) => hop.edgeId).join("\u001f")));
}

function result(
  direction: SolveGraphTraversalDirection,
  sourceId: string,
  targetId: string,
  paths: readonly SolveGraphAlternativePath[],
  statesCreated: number,
  truncated: boolean,
  truncationReason?: SolveGraphAlternativePathsResult["truncationReason"],
): SolveGraphAlternativePathsResult {
  return {
    direction,
    sourceId,
    targetId,
    paths: sortedPaths(paths),
    statesCreated,
    truncated,
    ...(truncationReason ? { truncationReason } : {}),
  };
}

export function findSolveGraphAlternativePaths(
  index: SolveGraphQueryIndex,
  sourceId: string,
  targetId: string,
  options: SolveGraphAlternativePathsOptions = {},
): SolveGraphAlternativePathsResult {
  if (!index.nodesById.has(sourceId)) throw new Error(`Solve Graph alternative-path source does not exist: ${sourceId}`);
  if (!index.nodesById.has(targetId)) throw new Error(`Solve Graph alternative-path target does not exist: ${targetId}`);

  const direction = options.direction ?? "dependencies";
  if (direction !== "dependencies" && direction !== "dependents") {
    throw new Error(`Solve Graph alternative-path direction is invalid: ${String(direction)}`);
  }

  const edgeKinds = normalizeEdgeKinds(options.edgeKinds);
  const maxDepth = boundedInteger(
    options.maxDepth ?? defaultSolveGraphQueryLimits.maxDepth,
    0,
    HARD_MAX_DEPTH,
    "Solve Graph alternative-path maxDepth",
  );
  const maxPaths = boundedInteger(
    options.maxPaths ?? 8,
    1,
    HARD_MAX_PATHS,
    "Solve Graph alternative-path maxPaths",
  );
  const maxStates = boundedInteger(
    options.maxStates ?? 5_000,
    1,
    HARD_MAX_STATES,
    "Solve Graph alternative-path maxStates",
  );

  if (sourceId === targetId) {
    return result(direction, sourceId, targetId, [{ nodeIds: [sourceId], hops: [] }], 1, false);
  }

  const queue: PathState[] = [{ nodeIds: [sourceId], hops: [], depth: 0 }];
  let queueIndex = 0;
  const paths: SolveGraphAlternativePath[] = [];
  let statesCreated = 1;
  let depthBoundaryReached = false;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;
    const currentId = current.nodeIds[current.nodeIds.length - 1];
    const candidateEdges = edgesForDirection(index, currentId, direction)
      .filter((edge) => !edgeKinds || edgeKinds.has(edge.kind));

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
        return result(direction, sourceId, targetId, paths, statesCreated, true, "state-count");
      }
      statesCreated += 1;

      const next: PathState = {
        nodeIds: [...current.nodeIds, neighborId],
        hops: [...current.hops, {
          edgeId: edge.id,
          edgeKind: edge.kind,
          from: currentId,
          to: neighborId,
        }],
        depth: current.depth + 1,
      };

      if (neighborId === targetId) {
        paths.push({ nodeIds: next.nodeIds, hops: next.hops });
        if (paths.length >= maxPaths) {
          const remainingSibling = candidateEdges
            .slice(edgeIndex + 1)
            .some((candidate) => !current.nodeIds.includes(neighborForDirection(candidate, direction)));
          if (remainingSibling || queueIndex < queue.length) {
            return result(direction, sourceId, targetId, paths, statesCreated, true, "path-count");
          }
        }
        continue;
      }

      queue.push(next);
    }
  }

  return result(
    direction,
    sourceId,
    targetId,
    paths,
    statesCreated,
    depthBoundaryReached,
    depthBoundaryReached ? "depth" : undefined,
  );
}
