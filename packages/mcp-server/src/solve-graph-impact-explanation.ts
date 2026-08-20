import {
  executeSolveGraphTool,
  type SolveGraphDocument,
  type SolveGraphToolNode,
  type SolveGraphToolResponse,
  type SolveGraphTraversalOptions,
} from "./solve-graph.js";

const HARD_MAX_QUERY_ENTRIES = 10_000;
const HARD_MAX_EXPLANATION_ROWS = 256;
const HARD_MAX_DEPTH = 64;

type SolveGraphTraversalResponse = Exclude<SolveGraphToolResponse, { tool: "solve_graph.find_nodes" }>;

export type SolveGraphImpactExplanationNode = Pick<SolveGraphToolNode, "id" | "kind" | "label">;

export type SolveGraphImpactExplanationStep = {
  depth: number;
  edgeId: string;
  edgeKind: string;
  dependent: SolveGraphImpactExplanationNode;
  dependency: SolveGraphImpactExplanationNode;
  sentence: string;
};

export type SolveGraphImpactExplanationRow = {
  node: SolveGraphImpactExplanationNode;
  root: SolveGraphImpactExplanationNode;
  depth: number;
  path: SolveGraphImpactExplanationNode[];
  steps: SolveGraphImpactExplanationStep[];
  sentence: string;
};

export type SolveGraphImpactExplanation = {
  schema: "solvelang.mcp.solve-graph.impact-explanation.v0";
  mode: "analyze-only";
  graphId: string;
  direction: "dependents";
  status: "complete" | "partial";
  roots: SolveGraphImpactExplanationNode[];
  headline: string;
  detail: string;
  rows: SolveGraphImpactExplanationRow[];
  notices: string[];
  summary: {
    rootCount: number;
    queryEntries: number;
    impactedNodes: number;
    explainedNodes: number;
    hiddenNodes: number;
    maximumObservedDepth: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    queryTruncated: boolean;
    presentationTruncated: boolean;
    maxRows: number;
  };
};

export type SolveGraphImpactExplanationOptions = SolveGraphTraversalOptions & {
  maxRows?: number;
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedMaxRows(value: number | undefined): number {
  const resolved = value ?? 100;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > HARD_MAX_EXPLANATION_ROWS) {
    throw new Error(`Solve Graph impact explanation maxRows must be an integer from 1 through ${HARD_MAX_EXPLANATION_ROWS}.`);
  }
  return resolved;
}

function safeNode(document: SolveGraphDocument, id: string): SolveGraphImpactExplanationNode {
  const node = document.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Solve Graph impact explanation references a missing node: ${id}`);
  return { id: node.id, kind: node.kind, label: node.label };
}

function assertCapabilityFreeDocument(document: SolveGraphDocument): void {
  if (document.mode !== "analyze-only"
    || document.execution.networkAccess !== false
    || document.execution.writeAccess !== false) {
    throw new Error("Solve Graph impact explanation requires an analyze-only capability-free document.");
  }
}

function assertResponse(
  document: SolveGraphDocument,
  response: SolveGraphTraversalResponse,
): Map<string, SolveGraphTraversalResponse["entries"][number]> {
  assertCapabilityFreeDocument(document);
  if (response.tool !== "solve_graph.impact") {
    throw new Error("Solve Graph impact explanation requires an impact response.");
  }
  if (response.graphId !== document.graphId) {
    throw new Error("Solve Graph impact explanation graph identity does not match the source document.");
  }
  if (response.roots.length === 0) {
    throw new Error("Solve Graph impact explanation requires at least one changed root.");
  }
  const canonicalRoots = [...new Set(response.roots)].sort(compareText);
  if (canonicalRoots.length !== response.roots.length
    || canonicalRoots.some((root, index) => root !== response.roots[index])) {
    throw new Error("Solve Graph impact explanation roots are not canonical.");
  }
  const nodesById = new Map(document.nodes.map((node) => [node.id, node] as const));
  const edgesById = new Map(document.edges.map((edge) => [edge.id, edge] as const));
  for (const root of response.roots) {
    if (!nodesById.has(root)) {
      throw new Error(`Solve Graph impact explanation root does not exist: ${root}`);
    }
  }
  if (response.entries.length === 0 || response.entries.length > HARD_MAX_QUERY_ENTRIES) {
    throw new Error("Solve Graph impact explanation query entry count is invalid.");
  }
  if (response.truncationReason !== undefined
    && response.truncationReason !== "depth"
    && response.truncationReason !== "result-count") {
    throw new Error("Solve Graph impact explanation truncation reason is invalid.");
  }
  if (response.truncated !== (response.truncationReason !== undefined)) {
    throw new Error("Solve Graph impact explanation truncation metadata is inconsistent.");
  }

  const rootSet = new Set(response.roots);
  const entryById = new Map<string, SolveGraphTraversalResponse["entries"][number]>();
  for (const entry of response.entries) {
    if (entryById.has(entry.id)) {
      throw new Error(`Solve Graph impact explanation contains duplicate traversal entry: ${entry.id}`);
    }
    const sourceNode = nodesById.get(entry.id);
    if (!sourceNode) {
      throw new Error(`Solve Graph impact explanation traversal node does not exist: ${entry.id}`);
    }
    if (entry.node.id !== sourceNode.id
      || entry.node.kind !== sourceNode.kind
      || entry.node.label !== sourceNode.label) {
      throw new Error("Solve Graph impact explanation traversal node summary does not match the source document.");
    }
    if (!rootSet.has(entry.rootId)) {
      throw new Error("Solve Graph impact explanation traversal entry has an unknown root.");
    }
    if (!Number.isSafeInteger(entry.depth) || entry.depth < 0 || entry.depth > HARD_MAX_DEPTH) {
      throw new Error("Solve Graph impact explanation traversal depth is invalid.");
    }

    if (entry.depth === 0) {
      if (entry.id !== entry.rootId
        || entry.parentId !== undefined
        || entry.viaEdgeId !== undefined
        || entry.viaEdgeKind !== undefined) {
        throw new Error("Solve Graph impact explanation root entry is malformed.");
      }
    } else {
      if (!entry.parentId || !entry.viaEdgeId || !entry.viaEdgeKind) {
        throw new Error("Solve Graph impact explanation non-root entry is missing traversal evidence.");
      }
      const parent = entryById.get(entry.parentId);
      if (!parent || parent.depth + 1 !== entry.depth || parent.rootId !== entry.rootId) {
        throw new Error("Solve Graph impact explanation parent chain is invalid.");
      }
      const edge = edgesById.get(entry.viaEdgeId);
      if (!edge
        || edge.kind !== entry.viaEdgeKind
        || edge.from !== entry.id
        || edge.to !== entry.parentId) {
        throw new Error("Solve Graph impact explanation edge traversal is invalid.");
      }
    }
    entryById.set(entry.id, entry);
  }

  return entryById;
}

function queryNotice(response: SolveGraphTraversalResponse): string | undefined {
  if (response.truncationReason === "depth") {
    return "Impact traversal reached the configured depth bound; additional dependent nodes may exist.";
  }
  if (response.truncationReason === "result-count") {
    return "Impact traversal reached the configured result-count bound; additional dependent nodes may exist.";
  }
  return undefined;
}

function pathForEntry(
  document: SolveGraphDocument,
  entry: SolveGraphTraversalResponse["entries"][number],
  entryById: ReadonlyMap<string, SolveGraphTraversalResponse["entries"][number]>,
): { nodes: SolveGraphImpactExplanationNode[]; steps: SolveGraphImpactExplanationStep[] } {
  const chain = [entry];
  let current = entry;
  while (current.depth > 0) {
    const parent = current.parentId ? entryById.get(current.parentId) : undefined;
    if (!parent) {
      throw new Error("Solve Graph impact explanation parent chain disappeared during rendering.");
    }
    chain.push(parent);
    current = parent;
  }
  chain.reverse();

  const nodes = chain.map((item) => safeNode(document, item.id));
  const edgesById = new Map(document.edges.map((edge) => [edge.id, edge] as const));
  const steps: SolveGraphImpactExplanationStep[] = [];
  for (let index = 1; index < chain.length; index += 1) {
    const childEntry = chain[index]!;
    const parentEntry = chain[index - 1]!;
    const edge = childEntry.viaEdgeId ? edgesById.get(childEntry.viaEdgeId) : undefined;
    if (!edge || edge.from !== childEntry.id || edge.to !== parentEntry.id) {
      throw new Error("Solve Graph impact explanation edge evidence changed during rendering.");
    }
    const dependent = nodes[index]!;
    const dependency = nodes[index - 1]!;
    steps.push({
      depth: childEntry.depth,
      edgeId: edge.id,
      edgeKind: edge.kind,
      dependent,
      dependency,
      sentence: `${dependent.label} --${edge.kind}--> ${dependency.label}`,
    });
  }
  return { nodes, steps };
}

export function createSolveGraphImpactExplanation(
  document: SolveGraphDocument,
  response: SolveGraphTraversalResponse,
  options: Pick<SolveGraphImpactExplanationOptions, "maxRows"> = {},
): SolveGraphImpactExplanation {
  const entryById = assertResponse(document, response);
  const maxRows = boundedMaxRows(options.maxRows);
  const impactedEntries = response.entries.filter((entry) => entry.depth > 0);
  const visibleEntries = impactedEntries.slice(0, maxRows);
  const presentationTruncated = impactedEntries.length > visibleEntries.length;
  const queryTruncated = response.truncated;
  const partial = queryTruncated || presentationTruncated;
  const roots = response.roots.map((root) => safeNode(document, root));

  const rows = visibleEntries.map((entry) => {
    const node = safeNode(document, entry.id);
    const root = safeNode(document, entry.rootId);
    const path = pathForEntry(document, entry, entryById);
    return {
      node,
      root,
      depth: entry.depth,
      path: path.nodes,
      steps: path.steps,
      sentence: `${node.label} is within ${entry.depth} dependent hop${entry.depth === 1 ? "" : "s"} of ${root.label}.`,
    };
  });

  const notices: string[] = [];
  const boundedQueryNotice = queryNotice(response);
  if (boundedQueryNotice) notices.push(boundedQueryNotice);
  if (presentationTruncated) {
    notices.push("This explanation shows only the first bounded subset of impacted nodes returned by the query.");
  }

  const impactedNodes = impactedEntries.length;
  const maximumObservedDepth = response.entries.reduce((maximum, entry) => Math.max(maximum, entry.depth), 0);
  let headline: string;
  let detail: string;
  if (impactedNodes === 0 && queryTruncated) {
    headline = "Impact search incomplete";
    detail = "No dependent node was established before the bounded traversal stopped; absence is not proven.";
  } else if (impactedNodes === 0) {
    headline = "No impacted dependent nodes found";
    detail = "No dependent node exists within the completely searched configured graph scope.";
  } else if (partial) {
    headline = "Impact evidence is partial";
    detail = queryTruncated
      ? `${impactedNodes} impacted node${impactedNodes === 1 ? " was" : "s were"} observed before the bounded traversal stopped; additional impacted nodes may exist.`
      : `The traversal completed with ${impactedNodes} impacted node${impactedNodes === 1 ? "" : "s"}; this bounded explanation shows ${rows.length} and hides ${impactedNodes - rows.length}.`;
  } else {
    headline = `${impactedNodes} impacted node${impactedNodes === 1 ? "" : "s"} observed`;
    detail = `The dependent traversal completed within the configured graph scope and explains all ${impactedNodes} impacted node${impactedNodes === 1 ? "" : "s"}.`;
  }

  return {
    schema: "solvelang.mcp.solve-graph.impact-explanation.v0",
    mode: "analyze-only",
    graphId: response.graphId,
    direction: "dependents",
    status: partial ? "partial" : "complete",
    roots,
    headline,
    detail,
    rows,
    notices,
    summary: {
      rootCount: roots.length,
      queryEntries: response.entries.length,
      impactedNodes,
      explainedNodes: rows.length,
      hiddenNodes: Math.max(0, impactedNodes - rows.length),
      maximumObservedDepth,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      queryTruncated,
      presentationTruncated,
      maxRows,
    },
  };
}

export function explainSolveGraphImpact(
  document: SolveGraphDocument,
  changedNodeIds: readonly string[],
  options: SolveGraphImpactExplanationOptions = {},
): SolveGraphImpactExplanation {
  assertCapabilityFreeDocument(document);
  const { maxRows, ...traversalOptions } = options;
  const response = executeSolveGraphTool(document, {
    tool: "solve_graph.impact",
    changedNodeIds,
    options: traversalOptions,
  });
  if (response.tool !== "solve_graph.impact") {
    throw new Error("Solve Graph impact explanation received the wrong query response.");
  }
  return createSolveGraphImpactExplanation(document, response, { maxRows });
}
