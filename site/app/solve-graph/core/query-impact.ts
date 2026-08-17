import { verifySolveGraphIntegrity } from "./canonical";
import {
  solveGraphEdgeKinds,
  solveGraphNodeKinds,
  type SolveGraphDocument,
  type SolveGraphEdge,
  type SolveGraphEdgeKind,
  type SolveGraphNode,
  type SolveGraphNodeKind,
} from "./contracts";

export const defaultSolveGraphQueryLimits = Object.freeze({
  maxDepth: 8,
  maxResults: 1_000,
});

const HARD_MAX_DEPTH = 64;
const HARD_MAX_RESULTS = 10_000;
const nodeKindSet = new Set<string>(solveGraphNodeKinds);
const edgeKindSet = new Set<string>(solveGraphEdgeKinds);

export const defaultSolveGraphImpactEdgeKinds = Object.freeze([
  "imports",
  "calls",
  "references",
  "reads",
  "writes",
  "exposes",
  "deploys",
  "grants",
  "tests",
  "depends-on",
  "triggers",
] satisfies SolveGraphEdgeKind[]);

export type SolveGraphQueryIndex = {
  document: SolveGraphDocument;
  nodesById: ReadonlyMap<string, SolveGraphNode>;
  outgoingByNodeId: ReadonlyMap<string, readonly SolveGraphEdge[]>;
  incomingByNodeId: ReadonlyMap<string, readonly SolveGraphEdge[]>;
};

export type SolveGraphNodeQuery = {
  kinds?: readonly SolveGraphNodeKind[];
  text?: string;
  evidencePath?: string;
  limit?: number;
};

export type SolveGraphTraversalDirection = "dependencies" | "dependents";

export type SolveGraphTraversalOptions = {
  edgeKinds?: readonly SolveGraphEdgeKind[];
  maxDepth?: number;
  maxResults?: number;
};

export type SolveGraphTraversalEntry = {
  id: string;
  depth: number;
  rootId: string;
  parentId?: string;
  viaEdgeId?: string;
};

export type SolveGraphTraversalResult = {
  direction: SolveGraphTraversalDirection;
  roots: string[];
  entries: SolveGraphTraversalEntry[];
  truncated: boolean;
  truncationReason?: "depth" | "result-count";
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function positiveBoundedInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return value;
}

function boundedDepth(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > HARD_MAX_DEPTH) {
    throw new Error(`Solve Graph query maxDepth must be an integer from 0 through ${HARD_MAX_DEPTH}.`);
  }
  return value;
}

function normalizeKinds<T extends string>(
  values: readonly T[] | undefined,
  allowed: ReadonlySet<string>,
  label: string,
): Set<T> | undefined {
  if (values === undefined) return undefined;
  const normalized = new Set<T>();
  for (const value of values) {
    if (!allowed.has(value)) throw new Error(`Solve Graph ${label} is invalid: ${value}`);
    normalized.add(value);
  }
  return normalized;
}

function normalizedOptionalText(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Solve Graph ${label} must be a string.`);
  const normalized = value.normalize("NFC").trim();
  if (!normalized) throw new Error(`Solve Graph ${label} must not be empty.`);
  if (normalized.length > 2_048) throw new Error(`Solve Graph ${label} is too large.`);
  return normalized;
}

function sortedEdges(edges: SolveGraphEdge[]): readonly SolveGraphEdge[] {
  return Object.freeze([...edges].sort((left, right) => compareText(left.id, right.id)));
}

export async function createSolveGraphQueryIndex(document: SolveGraphDocument): Promise<SolveGraphQueryIndex> {
  if (!(await verifySolveGraphIntegrity(document))) {
    throw new Error("Solve Graph query index requires an integrity-valid canonical document.");
  }

  const nodesById = new Map<string, SolveGraphNode>();
  const outgoing = new Map<string, SolveGraphEdge[]>();
  const incoming = new Map<string, SolveGraphEdge[]>();

  for (const node of document.nodes) {
    if (nodesById.has(node.id)) throw new Error(`Solve Graph contains duplicate node ID: ${node.id}`);
    nodesById.set(node.id, node);
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  for (const edge of document.edges) {
    const outgoingEdges = outgoing.get(edge.from);
    const incomingEdges = incoming.get(edge.to);
    if (!outgoingEdges || !incomingEdges) {
      throw new Error(`Solve Graph edge ${edge.id} references a missing node.`);
    }
    outgoingEdges.push(edge);
    incomingEdges.push(edge);
  }

  return {
    document,
    nodesById,
    outgoingByNodeId: new Map([...outgoing].map(([id, edges]) => [id, sortedEdges(edges)])),
    incomingByNodeId: new Map([...incoming].map(([id, edges]) => [id, sortedEdges(edges)])),
  };
}

export function findSolveGraphNodes(index: SolveGraphQueryIndex, query: SolveGraphNodeQuery = {}): SolveGraphNode[] {
  const kinds = normalizeKinds(query.kinds, nodeKindSet, "node kind");
  const text = normalizedOptionalText(query.text, "query text")?.toLocaleLowerCase("en-US");
  const evidencePath = normalizedOptionalText(query.evidencePath, "evidence path");
  const limit = positiveBoundedInteger(query.limit ?? 100, "Solve Graph query limit", HARD_MAX_RESULTS);

  const matches = index.document.nodes.filter((node) => {
    if (kinds && !kinds.has(node.kind)) return false;
    if (text) {
      const haystack = `${node.label}\n${node.identity}`.normalize("NFC").toLocaleLowerCase("en-US");
      if (!haystack.includes(text)) return false;
    }
    if (evidencePath && !node.evidence.some((evidence) => evidence.path === evidencePath)) return false;
    return true;
  });

  return matches.slice(0, limit);
}

function requireRoots(index: SolveGraphQueryIndex, rootIds: readonly string[]): string[] {
  if (rootIds.length === 0) throw new Error("Solve Graph traversal requires at least one root node ID.");
  const roots = [...new Set(rootIds)].sort(compareText);
  for (const id of roots) {
    if (!index.nodesById.has(id)) throw new Error(`Solve Graph traversal root does not exist: ${id}`);
  }
  return roots;
}

function neighborForDirection(edge: SolveGraphEdge, direction: SolveGraphTraversalDirection): string {
  return direction === "dependencies" ? edge.to : edge.from;
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

export function traverseSolveGraph(
  index: SolveGraphQueryIndex,
  rootIds: readonly string[],
  direction: SolveGraphTraversalDirection,
  options: SolveGraphTraversalOptions = {},
): SolveGraphTraversalResult {
  if (direction !== "dependencies" && direction !== "dependents") {
    throw new Error(`Solve Graph traversal direction is invalid: ${direction}`);
  }

  const roots = requireRoots(index, rootIds);
  const edgeKinds = normalizeKinds(options.edgeKinds, edgeKindSet, "edge kind");
  const maxDepth = boundedDepth(options.maxDepth ?? defaultSolveGraphQueryLimits.maxDepth);
  const maxResults = positiveBoundedInteger(
    options.maxResults ?? defaultSolveGraphQueryLimits.maxResults,
    "Solve Graph traversal maxResults",
    HARD_MAX_RESULTS,
  );

  const entries: SolveGraphTraversalEntry[] = [];
  const visited = new Set<string>();
  const queue: SolveGraphTraversalEntry[] = roots.map((id) => ({ id, depth: 0, rootId: id }));
  let depthBoundaryReached = false;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    if (entries.length >= maxResults) {
      return { direction, roots, entries, truncated: true, truncationReason: "result-count" };
    }
    entries.push(current);

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
      if (visited.has(neighborId) || queue.some((entry) => entry.id === neighborId)) continue;
      queue.push({
        id: neighborId,
        depth: current.depth + 1,
        rootId: current.rootId,
        parentId: current.id,
        viaEdgeId: edge.id,
      });
    }
  }

  return {
    direction,
    roots,
    entries,
    truncated: depthBoundaryReached,
    ...(depthBoundaryReached ? { truncationReason: "depth" as const } : {}),
  };
}

export function analyzeSolveGraphImpact(
  index: SolveGraphQueryIndex,
  changedNodeIds: readonly string[],
  options: SolveGraphTraversalOptions = {},
): SolveGraphTraversalResult {
  return traverseSolveGraph(index, changedNodeIds, "dependents", {
    ...options,
    edgeKinds: options.edgeKinds ?? defaultSolveGraphImpactEdgeKinds,
  });
}
