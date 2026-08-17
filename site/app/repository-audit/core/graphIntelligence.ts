import {
  solveGraphEdgeKinds,
  solveGraphNodeKinds,
  type SolveGraphDocument,
  type SolveGraphEdgeKind,
  type SolveGraphNode,
  type SolveGraphNodeKind,
} from "../../solve-graph/core/contracts";
import {
  analyzeSolveGraphImpact,
  createSolveGraphQueryIndex,
  defaultSolveGraphImpactEdgeKinds,
} from "../../solve-graph/core/query-impact";

export type RepositoryGraphHotspot = {
  nodeId: string;
  kind: SolveGraphNodeKind;
  label: string;
  path?: string;
  directDependencies: number;
  directDependents: number;
  transitiveImpact: number;
  impactTruncated: boolean;
};

export type RepositoryGraphIntelligence = {
  schema: "solvelang.repository-audit.graph-intelligence.v0";
  mode: "analyze-only";
  graphId: string;
  source: {
    displayName: string;
    revision: string;
    fingerprint: string;
  };
  counts: {
    nodes: number;
    edges: number;
    nodesByKind: Array<{ kind: SolveGraphNodeKind; count: number }>;
    edgesByKind: Array<{ kind: SolveGraphEdgeKind; count: number }>;
  };
  hotspots: RepositoryGraphHotspot[];
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxHotspots: number;
    maxImpactDepth: number;
    maxImpactResults: number;
    hotspotCandidatesTruncated: boolean;
  };
};

export type RepositoryGraphIntelligenceOptions = {
  maxHotspots?: number;
  maxImpactDepth?: number;
  maxImpactResults?: number;
};

const hotspotNodeKinds = new Set<SolveGraphNodeKind>([
  "file",
  "module",
  "symbol",
  "function",
  "class",
  "type",
  "route",
  "dependency",
  "workflow",
  "job",
  "resource",
  "permission",
]);

const impactEdgeKinds = new Set<SolveGraphEdgeKind>(defaultSolveGraphImpactEdgeKinds);

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

function pathForNode(node: SolveGraphNode): string | undefined {
  const metadataPath = node.metadata?.path;
  if (typeof metadataPath === "string" && metadataPath.length > 0) return metadataPath;
  return node.evidence[0]?.path;
}

function countKinds<T extends string>(values: readonly T[], orderedKinds: readonly T[]): Array<{ kind: T; count: number }> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return orderedKinds.map((kind) => ({ kind, count: counts.get(kind) ?? 0 })).filter((item) => item.count > 0);
}

export async function createRepositoryGraphIntelligence(
  document: SolveGraphDocument,
  options: RepositoryGraphIntelligenceOptions = {},
): Promise<RepositoryGraphIntelligence> {
  const maxHotspots = boundedInteger(options.maxHotspots, 30, 1, 100, "Repository graph maxHotspots");
  const maxImpactDepth = boundedInteger(options.maxImpactDepth, 4, 0, 16, "Repository graph maxImpactDepth");
  const maxImpactResults = boundedInteger(options.maxImpactResults, 500, 1, 5_000, "Repository graph maxImpactResults");
  const index = await createSolveGraphQueryIndex(document);

  const candidates = document.nodes
    .filter((node) => hotspotNodeKinds.has(node.kind))
    .map((node) => {
      const directDependencies = (index.outgoingByNodeId.get(node.id) ?? []).filter((edge) => impactEdgeKinds.has(edge.kind)).length;
      const directDependents = (index.incomingByNodeId.get(node.id) ?? []).filter((edge) => impactEdgeKinds.has(edge.kind)).length;
      return { node, directDependencies, directDependents };
    })
    .filter((candidate) => candidate.directDependents > 0)
    .sort((left, right) =>
      right.directDependents - left.directDependents
      || right.directDependencies - left.directDependencies
      || compareText(left.node.id, right.node.id));

  const hotspotCandidatesTruncated = candidates.length > maxHotspots;
  const hotspots: RepositoryGraphHotspot[] = [];
  for (const candidate of candidates.slice(0, maxHotspots)) {
    const impact = analyzeSolveGraphImpact(index, [candidate.node.id], {
      maxDepth: maxImpactDepth,
      maxResults: maxImpactResults,
    });
    hotspots.push({
      nodeId: candidate.node.id,
      kind: candidate.node.kind,
      label: candidate.node.label,
      ...(pathForNode(candidate.node) ? { path: pathForNode(candidate.node) } : {}),
      directDependencies: candidate.directDependencies,
      directDependents: candidate.directDependents,
      transitiveImpact: Math.max(0, impact.entries.length - 1),
      impactTruncated: impact.truncated,
    });
  }

  hotspots.sort((left, right) =>
    right.transitiveImpact - left.transitiveImpact
    || right.directDependents - left.directDependents
    || compareText(left.nodeId, right.nodeId));

  return {
    schema: "solvelang.repository-audit.graph-intelligence.v0",
    mode: "analyze-only",
    graphId: document.graphId,
    source: {
      displayName: document.source.displayName,
      revision: document.source.revision,
      fingerprint: document.source.fingerprint,
    },
    counts: {
      nodes: document.nodes.length,
      edges: document.edges.length,
      nodesByKind: countKinds(document.nodes.map((node) => node.kind), solveGraphNodeKinds),
      edgesByKind: countKinds(document.edges.map((edge) => edge.kind), solveGraphEdgeKinds),
    },
    hotspots,
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxHotspots,
      maxImpactDepth,
      maxImpactResults,
      hotspotCandidatesTruncated,
    },
  };
}
