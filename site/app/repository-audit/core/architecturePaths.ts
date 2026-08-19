import type {
  SolveGraphDocument,
  SolveGraphEdge,
  SolveGraphEdgeKind,
  SolveGraphNode,
  SolveGraphNodeKind,
} from "../../solve-graph/core/contracts";
import {
  createSolveGraphQueryIndex,
  traverseSolveGraph,
  type SolveGraphTraversalEntry,
} from "../../solve-graph/core/query-impact";

export const repositoryArchitecturePathEdgeKinds = Object.freeze([
  "imports",
  "calls",
  "references",
  "reads",
  "writes",
  "exposes",
  "deploys",
  "grants",
  "depends-on",
  "triggers",
] satisfies SolveGraphEdgeKind[]);

const rootKinds = new Set<SolveGraphNodeKind>(["route", "workflow", "job"]);
const targetKinds = new Set<SolveGraphNodeKind>(["dependency", "resource", "permission"]);
const securityEdgeKinds = new Set<SolveGraphEdgeKind>(["exposes", "grants"]);

export type RepositoryArchitecturePathSegment = {
  edgeId: string;
  kind: SolveGraphEdgeKind;
  from: string;
  to: string;
  evidence?: {
    path: string;
    line?: number;
  };
};

export type RepositoryArchitecturePathSummary = {
  classification: "architecture" | "security-boundary";
  root: {
    nodeId: string;
    kind: SolveGraphNodeKind;
    path?: string;
  };
  target: {
    nodeId: string;
    kind: SolveGraphNodeKind;
    path?: string;
  };
  depth: number;
  segments: RepositoryArchitecturePathSegment[];
};

export type RepositoryArchitecturePathAnalysis = {
  schema: "solvelang.repository-audit.architecture-paths.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  summary: {
    rootCandidates: number;
    rootsAnalyzed: number;
    architecturePaths: number;
    securityBoundaryPaths: number;
  };
  paths: RepositoryArchitecturePathSummary[];
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxRootNodes: number;
    maxDepth: number;
    maxTraversalResults: number;
    maxPaths: number;
    graphTruncated: boolean;
    rootsTruncated: boolean;
    traversalTruncated: boolean;
    pathsTruncated: boolean;
  };
};

export type RepositoryArchitecturePathOptions = {
  maxRootNodes?: number;
  maxDepth?: number;
  maxTraversalResults?: number;
  maxPaths?: number;
};

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

function nodePath(node: SolveGraphNode): string | undefined {
  const metadataPath = node.metadata?.path;
  if (typeof metadataPath === "string" && metadataPath.length > 0) return metadataPath;
  return node.evidence[0]?.path;
}

function nodeReference(node: SolveGraphNode) {
  const path = nodePath(node);
  return {
    nodeId: node.id,
    kind: node.kind,
    ...(path ? { path } : {}),
  };
}

function segment(edge: SolveGraphEdge): RepositoryArchitecturePathSegment {
  const evidence = edge.evidence[0];
  return {
    edgeId: edge.id,
    kind: edge.kind,
    from: edge.from,
    to: edge.to,
    ...(evidence ? {
      evidence: {
        path: evidence.path,
        ...(evidence.line === undefined ? {} : { line: evidence.line }),
      },
    } : {}),
  };
}

function reconstructSegments(
  entry: SolveGraphTraversalEntry,
  entriesById: ReadonlyMap<string, SolveGraphTraversalEntry>,
  edgesById: ReadonlyMap<string, SolveGraphEdge>,
): RepositoryArchitecturePathSegment[] {
  const reversed: RepositoryArchitecturePathSegment[] = [];
  let current: SolveGraphTraversalEntry | undefined = entry;
  while (current?.parentId && current.viaEdgeId) {
    const edge = edgesById.get(current.viaEdgeId);
    if (!edge) throw new Error(`Repository architecture path references missing edge: ${current.viaEdgeId}`);
    reversed.push(segment(edge));
    current = entriesById.get(current.parentId);
    if (!current) throw new Error(`Repository architecture path references missing parent: ${entry.id}`);
  }
  return reversed.reverse();
}

function isSecurityBoundary(target: SolveGraphNode, segments: readonly RepositoryArchitecturePathSegment[]): boolean {
  return target.kind === "permission" || segments.some((item) => securityEdgeKinds.has(item.kind));
}

function comparePaths(left: RepositoryArchitecturePathSummary, right: RepositoryArchitecturePathSummary): number {
  return compareText(left.root.nodeId, right.root.nodeId)
    || left.depth - right.depth
    || compareText(left.target.nodeId, right.target.nodeId)
    || compareText(left.segments.map((item) => item.edgeId).join("|"), right.segments.map((item) => item.edgeId).join("|"));
}

export async function analyzeRepositoryArchitecturePaths(
  document: SolveGraphDocument,
  options: RepositoryArchitecturePathOptions = {},
): Promise<RepositoryArchitecturePathAnalysis> {
  const maxRootNodes = boundedInteger(options.maxRootNodes, 50, 1, 500, "Repository architecture maxRootNodes");
  const maxDepth = boundedInteger(options.maxDepth, 6, 0, 16, "Repository architecture maxDepth");
  const maxTraversalResults = boundedInteger(
    options.maxTraversalResults,
    1_000,
    1,
    5_000,
    "Repository architecture maxTraversalResults",
  );
  const maxPaths = boundedInteger(options.maxPaths, 200, 1, 2_000, "Repository architecture maxPaths");
  const index = await createSolveGraphQueryIndex(document);
  const edgesById = new Map(document.edges.map((edge) => [edge.id, edge]));

  const rootCandidates = document.nodes
    .filter((node) => rootKinds.has(node.kind))
    .sort((left, right) => compareText(left.id, right.id));
  const rootsTruncated = rootCandidates.length > maxRootNodes;
  const roots = rootCandidates.slice(0, maxRootNodes);
  const candidates: RepositoryArchitecturePathSummary[] = [];
  let traversalTruncated = false;

  for (const root of roots) {
    const traversal = traverseSolveGraph(index, [root.id], "dependencies", {
      edgeKinds: repositoryArchitecturePathEdgeKinds,
      maxDepth,
      maxResults: maxTraversalResults,
    });
    traversalTruncated ||= traversal.truncated;
    const entriesById = new Map(traversal.entries.map((entry) => [entry.id, entry]));

    for (const entry of traversal.entries) {
      if (entry.depth === 0) continue;
      const target = index.nodesById.get(entry.id);
      if (!target || !targetKinds.has(target.kind)) continue;
      const segments = reconstructSegments(entry, entriesById, edgesById);
      candidates.push({
        classification: isSecurityBoundary(target, segments) ? "security-boundary" : "architecture",
        root: nodeReference(root),
        target: nodeReference(target),
        depth: entry.depth,
        segments,
      });
    }
  }

  candidates.sort(comparePaths);
  const pathsTruncated = candidates.length > maxPaths;
  const paths = candidates.slice(0, maxPaths);
  const graphTruncated = document.execution.status === "partial" || document.execution.truncated;
  const partial = graphTruncated || rootsTruncated || traversalTruncated || pathsTruncated;

  return {
    schema: "solvelang.repository-audit.architecture-paths.v0",
    mode: "analyze-only",
    graphId: document.graphId,
    status: partial ? "partial" : "complete",
    summary: {
      rootCandidates: rootCandidates.length,
      rootsAnalyzed: roots.length,
      architecturePaths: paths.filter((item) => item.classification === "architecture").length,
      securityBoundaryPaths: paths.filter((item) => item.classification === "security-boundary").length,
    },
    paths,
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRootNodes,
      maxDepth,
      maxTraversalResults,
      maxPaths,
      graphTruncated,
      rootsTruncated,
      traversalTruncated,
      pathsTruncated,
    },
  };
}
