import {
  defaultSolveGraphImpactEdgeKinds,
  executeSolveGraphTool,
  SOLVE_GRAPH_TOOL_API_VERSION,
  solveGraphEdgeKinds,
  type SolveGraphDocument,
  type SolveGraphEdgeKind,
  type SolveGraphNode,
  type SolveGraphNodeKind,
  type SolveGraphToolNode,
} from "./solve-graph.js";

export const MAX_SOLVE_GRAPH_HOTSPOTS = 100;

export type SolveGraphHotspotOptions = {
  edgeKinds?: readonly SolveGraphEdgeKind[];
  maxHotspots?: number;
  maxImpactDepth?: number;
  maxImpactResults?: number;
};

export type SolveGraphHotspotResponse = {
  apiVersion: typeof SOLVE_GRAPH_TOOL_API_VERSION;
  tool: "solve_graph.hotspots";
  graphId: string;
  hotspots: Array<{
    node: SolveGraphToolNode;
    directDependencies: number;
    directDependents: number;
    transitiveDependents: number;
    impactTruncated: boolean;
  }>;
  summary: {
    eligibleCandidates: number;
    returnedHotspots: number;
    hiddenCandidates: number;
  };
  truncated: boolean;
  notices: string[];
  execution: {
    networkAccess: false;
    writeAccess: false;
    edgeKinds: SolveGraphEdgeKind[];
    maxHotspots: number;
    maxImpactDepth: number;
    maxImpactResults: number;
  };
};

const hotspotNodeKinds = new Set<SolveGraphNodeKind>([
  "file", "module", "symbol", "function", "class", "type", "route", "dependency", "workflow", "job", "resource", "permission",
]);
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

function normalizedEdgeKinds(values: readonly SolveGraphEdgeKind[] | undefined): SolveGraphEdgeKind[] {
  const unique = [...new Set(values ?? defaultSolveGraphImpactEdgeKinds)].sort(compareText);
  for (const value of unique) if (!edgeKindSet.has(value)) throw new Error(`Solve Graph hotspot edge kind is invalid: ${value}`);
  return unique as SolveGraphEdgeKind[];
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

function assertCapabilityFreeDocument(document: SolveGraphDocument): void {
  if (document.mode !== "analyze-only" || document.execution.networkAccess !== false || document.execution.writeAccess !== false) {
    throw new Error("Solve Graph hotspot analysis requires an analyze-only capability-free document.");
  }
}

export function findSolveGraphHotspots(document: SolveGraphDocument, options: SolveGraphHotspotOptions = {}): SolveGraphHotspotResponse {
  assertCapabilityFreeDocument(document);
  const edgeKinds = normalizedEdgeKinds(options.edgeKinds);
  const edgeKindSetForQuery = new Set(edgeKinds);
  const maxHotspots = boundedInteger(options.maxHotspots, 30, 1, MAX_SOLVE_GRAPH_HOTSPOTS, "Solve Graph hotspot maxHotspots");
  const maxImpactDepth = boundedInteger(options.maxImpactDepth, 4, 0, 64, "Solve Graph hotspot maxImpactDepth");
  const maxImpactResults = boundedInteger(options.maxImpactResults, 500, 1, 10_000, "Solve Graph hotspot maxImpactResults");
  const outgoing = new Map(document.nodes.map((node) => [node.id, 0]));
  const incoming = new Map(document.nodes.map((node) => [node.id, 0]));
  for (const edge of document.edges) {
    if (!edgeKindSetForQuery.has(edge.kind)) continue;
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const candidates = document.nodes
    .filter((node) => hotspotNodeKinds.has(node.kind))
    .map((node) => ({ node, directDependencies: outgoing.get(node.id) ?? 0, directDependents: incoming.get(node.id) ?? 0 }))
    .filter((candidate) => candidate.directDependents > 0)
    .sort((left, right) => right.directDependents - left.directDependents
      || right.directDependencies - left.directDependencies
      || compareText(left.node.id, right.node.id));
  const hotspots = candidates.slice(0, maxHotspots).map((candidate) => {
    const impact = executeSolveGraphTool(document, {
      tool: "solve_graph.impact",
      changedNodeIds: [candidate.node.id],
      options: { edgeKinds, maxDepth: maxImpactDepth, maxResults: maxImpactResults },
    });
    if (impact.tool !== "solve_graph.impact") throw new Error("Solve Graph hotspot analysis received an invalid impact response.");
    return {
      node: safeNode(candidate.node),
      directDependencies: candidate.directDependencies,
      directDependents: candidate.directDependents,
      transitiveDependents: Math.max(0, impact.entries.length - 1),
      impactTruncated: impact.truncated,
    };
  }).sort((left, right) => right.transitiveDependents - left.transitiveDependents
    || right.directDependents - left.directDependents
    || compareText(left.node.id, right.node.id));
  const truncated = candidates.length > hotspots.length;
  return {
    apiVersion: SOLVE_GRAPH_TOOL_API_VERSION,
    tool: "solve_graph.hotspots",
    graphId: document.graphId,
    hotspots,
    summary: { eligibleCandidates: candidates.length, returnedHotspots: hotspots.length, hiddenCandidates: candidates.length - hotspots.length },
    truncated,
    notices: [
      "Hotspots are structural candidate evidence only; they do not establish runtime criticality or defects.",
      ...(truncated ? ["Additional eligible hotspot candidates were omitted by the hotspot-count bound."] : []),
      ...(hotspots.some((hotspot) => hotspot.impactTruncated) ? ["At least one hotspot's transitive dependent count is partial because its bounded impact traversal stopped early."] : []),
    ],
    execution: { networkAccess: false, writeAccess: false, edgeKinds, maxHotspots, maxImpactDepth, maxImpactResults },
  };
}
