import type {
  RepositoryAuditVisualExplorer,
  RepositoryAuditVisualExplorerEdge,
  RepositoryAuditVisualExplorerNode,
} from "./visualExplorer";

export type RepositoryAuditVisualExplorerPresentationNode = RepositoryAuditVisualExplorerNode & {
  selected: boolean;
  directNeighbor: boolean;
};

export type RepositoryAuditVisualExplorerPresentation = {
  schema: "solvelang.repository-audit.visual-explorer-presentation.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  query: string;
  kinds: RepositoryAuditVisualExplorerNode["kind"][];
  nodes: RepositoryAuditVisualExplorerPresentationNode[];
  edges: RepositoryAuditVisualExplorerEdge[];
  summary: {
    sourceNodes: number;
    sourceEdges: number;
    matchingNodes: number;
    shownNodes: number;
    hiddenNodesByFilter: number;
    hiddenNodesByLimit: number;
    candidateEdges: number;
    shownEdges: number;
    hiddenEdgesByLimit: number;
    selectedNodeFound: boolean;
    selectedNodeShown: boolean;
    directNeighborsShown: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxNodes: number;
    maxEdges: number;
    queryTruncated: false;
    nodesTruncated: boolean;
    edgesTruncated: boolean;
    sourcePartial: boolean;
  };
};

export type RepositoryAuditVisualExplorerPresentationOptions = {
  query?: string;
  kinds?: RepositoryAuditVisualExplorerNode["kind"][];
  selectedNodeId?: string;
  maxNodes?: number;
  maxEdges?: number;
};

const encoder = new TextEncoder();
const MAX_QUERY_BYTES = 256;
const MAX_KIND_FILTERS = 16;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function normalizeQuery(value: string | undefined): string {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (encoder.encode(normalized).length > MAX_QUERY_BYTES) {
    throw new Error(`Repository Audit visual explorer query must be at most ${MAX_QUERY_BYTES} UTF-8 bytes.`);
  }
  return normalized;
}

function normalizeKinds(
  kinds: RepositoryAuditVisualExplorerNode["kind"][] | undefined,
): RepositoryAuditVisualExplorerNode["kind"][] {
  if (!kinds?.length) return [];
  if (kinds.length > MAX_KIND_FILTERS) {
    throw new Error(`Repository Audit visual explorer kinds must contain at most ${MAX_KIND_FILTERS} entries.`);
  }
  return [...new Set(kinds)].sort();
}

function assertExplorerContract(explorer: RepositoryAuditVisualExplorer): void {
  if (explorer.schema !== "solvelang.repository-audit.visual-explorer.v0" || explorer.mode !== "analyze-only") {
    throw new Error("Repository Audit visual explorer presentation requires a supported analyze-only explorer document.");
  }
  if (explorer.execution.networkAccess !== false || explorer.execution.writeAccess !== false) {
    throw new Error("Repository Audit visual explorer presentation rejects mutable or network-enabled explorer documents.");
  }

  const nodeIds = new Set<string>();
  for (const node of explorer.nodes) {
    if (!node.id || nodeIds.has(node.id)) {
      throw new Error("Repository Audit visual explorer presentation requires unique non-empty node ids.");
    }
    nodeIds.add(node.id);
  }
  for (const edge of explorer.edges) {
    if (!edge.id || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error("Repository Audit visual explorer presentation requires edges with visible explorer endpoints.");
    }
  }
}

function nodeMatchesQuery(node: RepositoryAuditVisualExplorerNode, query: string): boolean {
  if (!query) return true;
  const haystack = `${node.kind} ${node.label} ${node.path ?? ""}`.toLowerCase();
  return query.split(" ").every((token) => haystack.includes(token));
}

export function createRepositoryAuditVisualExplorerPresentation(
  explorer: RepositoryAuditVisualExplorer,
  options: RepositoryAuditVisualExplorerPresentationOptions = {},
): RepositoryAuditVisualExplorerPresentation {
  assertExplorerContract(explorer);

  const maxNodes = boundedInteger(options.maxNodes, 120, 1, 1_000, "Repository Audit visual explorer presentation maxNodes");
  const maxEdges = boundedInteger(options.maxEdges, 240, 1, 2_000, "Repository Audit visual explorer presentation maxEdges");
  const query = normalizeQuery(options.query);
  const kinds = normalizeKinds(options.kinds);
  const kindSet = new Set(kinds);

  const selectedSource = options.selectedNodeId
    ? explorer.nodes.find((node) => node.id === options.selectedNodeId)
    : undefined;

  const matchingNodes = explorer.nodes.filter((node) => {
    if (kindSet.size > 0 && !kindSet.has(node.kind)) return false;
    return nodeMatchesQuery(node, query);
  });

  const selectedMatches = selectedSource !== undefined && matchingNodes.some((node) => node.id === selectedSource.id);
  const orderedNodes = selectedMatches
    ? [selectedSource, ...matchingNodes.filter((node) => node.id !== selectedSource.id)]
    : matchingNodes;
  const shownSourceNodes = orderedNodes.slice(0, maxNodes);
  const shownIds = new Set(shownSourceNodes.map((node) => node.id));
  const selectedShown = selectedSource !== undefined && shownIds.has(selectedSource.id);

  const candidateEdges = explorer.edges.filter((edge) => shownIds.has(edge.from) && shownIds.has(edge.to));
  const orderedEdges = selectedShown
    ? [
        ...candidateEdges.filter((edge) => edge.from === selectedSource!.id || edge.to === selectedSource!.id),
        ...candidateEdges.filter((edge) => edge.from !== selectedSource!.id && edge.to !== selectedSource!.id),
      ]
    : candidateEdges;
  const edges = orderedEdges.slice(0, maxEdges).map((edge) => ({ ...edge }));

  const neighborIds = new Set<string>();
  if (selectedShown) {
    for (const edge of edges) {
      if (edge.from === selectedSource!.id) neighborIds.add(edge.to);
      if (edge.to === selectedSource!.id) neighborIds.add(edge.from);
    }
    neighborIds.delete(selectedSource!.id);
  }

  const nodes = shownSourceNodes.map((node) => ({
    ...node,
    selected: selectedShown && node.id === selectedSource!.id,
    directNeighbor: neighborIds.has(node.id),
  }));

  const hiddenNodesByFilter = Math.max(0, explorer.nodes.length - matchingNodes.length);
  const hiddenNodesByLimit = Math.max(0, matchingNodes.length - nodes.length);
  const hiddenEdgesByLimit = Math.max(0, candidateEdges.length - edges.length);
  const nodesTruncated = hiddenNodesByLimit > 0;
  const edgesTruncated = hiddenEdgesByLimit > 0;
  const sourcePartial = explorer.status === "partial" || explorer.execution.graphPartial;

  return {
    schema: "solvelang.repository-audit.visual-explorer-presentation.v0",
    mode: "analyze-only",
    graphId: explorer.graphId,
    status: sourcePartial || nodesTruncated || edgesTruncated ? "partial" : "complete",
    query,
    kinds,
    nodes,
    edges,
    summary: {
      sourceNodes: explorer.nodes.length,
      sourceEdges: explorer.edges.length,
      matchingNodes: matchingNodes.length,
      shownNodes: nodes.length,
      hiddenNodesByFilter,
      hiddenNodesByLimit,
      candidateEdges: candidateEdges.length,
      shownEdges: edges.length,
      hiddenEdgesByLimit,
      selectedNodeFound: selectedSource !== undefined,
      selectedNodeShown: selectedShown,
      directNeighborsShown: neighborIds.size,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxNodes,
      maxEdges,
      queryTruncated: false,
      nodesTruncated,
      edgesTruncated,
      sourcePartial,
    },
  };
}
