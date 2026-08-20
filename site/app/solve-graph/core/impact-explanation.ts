import type { SolveGraphNode } from "./contracts";
import type {
  SolveGraphQueryIndex,
  SolveGraphTraversalEntry,
  SolveGraphTraversalResult,
} from "./query-impact";

const HARD_MAX_QUERY_ENTRIES = 10_000;
const HARD_MAX_EXPLANATION_ROWS = 256;
const HARD_MAX_DEPTH = 64;

export type SolveGraphImpactExplanationNode = {
  id: string;
  kind: SolveGraphNode["kind"];
  label: string;
};

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
  schema: "solvelang.solve-graph.impact-explanation.v0";
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

export type SolveGraphImpactExplanationOptions = {
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

function explainNode(index: SolveGraphQueryIndex, id: string): SolveGraphImpactExplanationNode {
  const node = index.nodesById.get(id);
  if (!node) throw new Error(`Solve Graph impact explanation references a missing node: ${id}`);
  return { id: node.id, kind: node.kind, label: node.label };
}

function assertResult(index: SolveGraphQueryIndex, result: SolveGraphTraversalResult): Map<string, SolveGraphTraversalEntry> {
  if (result.direction !== "dependents") {
    throw new Error("Solve Graph impact explanation requires dependent traversal evidence.");
  }
  if (result.roots.length === 0) {
    throw new Error("Solve Graph impact explanation requires at least one root.");
  }
  const normalizedRoots = [...new Set(result.roots)].sort(compareText);
  if (normalizedRoots.length !== result.roots.length
    || normalizedRoots.some((root, index_) => root !== result.roots[index_])) {
    throw new Error("Solve Graph impact explanation roots are not canonical.");
  }
  for (const root of result.roots) {
    if (!index.nodesById.has(root)) {
      throw new Error(`Solve Graph impact explanation root does not exist: ${root}`);
    }
  }
  if (result.entries.length === 0 || result.entries.length > HARD_MAX_QUERY_ENTRIES) {
    throw new Error("Solve Graph impact explanation query entry count is invalid.");
  }
  if (result.truncationReason !== undefined
    && result.truncationReason !== "depth"
    && result.truncationReason !== "result-count") {
    throw new Error("Solve Graph impact explanation truncation reason is invalid.");
  }
  if (result.truncated !== (result.truncationReason !== undefined)) {
    throw new Error("Solve Graph impact explanation truncation metadata is inconsistent.");
  }

  const entryById = new Map<string, SolveGraphTraversalEntry>();
  const edgeById = new Map(index.document.edges.map((edge) => [edge.id, edge] as const));
  const rootSet = new Set(result.roots);

  for (const entry of result.entries) {
    if (entryById.has(entry.id)) {
      throw new Error(`Solve Graph impact explanation contains duplicate traversal entry: ${entry.id}`);
    }
    if (!index.nodesById.has(entry.id)) {
      throw new Error(`Solve Graph impact explanation traversal node does not exist: ${entry.id}`);
    }
    if (!rootSet.has(entry.rootId)) {
      throw new Error("Solve Graph impact explanation traversal entry has an unknown root.");
    }
    if (!Number.isSafeInteger(entry.depth) || entry.depth < 0 || entry.depth > HARD_MAX_DEPTH) {
      throw new Error("Solve Graph impact explanation traversal depth is invalid.");
    }

    if (entry.depth === 0) {
      if (entry.id !== entry.rootId || entry.parentId !== undefined || entry.viaEdgeId !== undefined) {
        throw new Error("Solve Graph impact explanation root entry is malformed.");
      }
    } else {
      if (!entry.parentId || !entry.viaEdgeId) {
        throw new Error("Solve Graph impact explanation non-root entry is missing traversal evidence.");
      }
      const parent = entryById.get(entry.parentId);
      if (!parent || parent.depth + 1 !== entry.depth || parent.rootId !== entry.rootId) {
        throw new Error("Solve Graph impact explanation parent chain is invalid.");
      }
      const edge = edgeById.get(entry.viaEdgeId);
      if (!edge || edge.from !== entry.id || edge.to !== entry.parentId) {
        throw new Error("Solve Graph impact explanation edge traversal is invalid.");
      }
    }
    entryById.set(entry.id, entry);
  }

  return entryById;
}

function impactNotice(result: SolveGraphTraversalResult): string | undefined {
  if (result.truncationReason === "depth") {
    return "Impact traversal reached the configured depth bound; additional dependent nodes may exist.";
  }
  if (result.truncationReason === "result-count") {
    return "Impact traversal reached the configured result-count bound; additional dependent nodes may exist.";
  }
  return undefined;
}

function pathForEntry(
  index: SolveGraphQueryIndex,
  entry: SolveGraphTraversalEntry,
  entryById: ReadonlyMap<string, SolveGraphTraversalEntry>,
): { nodes: SolveGraphImpactExplanationNode[]; steps: SolveGraphImpactExplanationStep[] } {
  const chain: SolveGraphTraversalEntry[] = [entry];
  let current = entry;
  while (current.depth > 0) {
    const parent = current.parentId ? entryById.get(current.parentId) : undefined;
    if (!parent) throw new Error("Solve Graph impact explanation parent chain disappeared during rendering.");
    chain.push(parent);
    current = parent;
  }
  chain.reverse();

  const nodes = chain.map((item) => explainNode(index, item.id));
  const edgeById = new Map(index.document.edges.map((edge) => [edge.id, edge] as const));
  const steps: SolveGraphImpactExplanationStep[] = [];
  for (let index_ = 1; index_ < chain.length; index_ += 1) {
    const childEntry = chain[index_]!;
    const parentEntry = chain[index_ - 1]!;
    const edge = edgeById.get(childEntry.viaEdgeId!);
    if (!edge || edge.from !== childEntry.id || edge.to !== parentEntry.id) {
      throw new Error("Solve Graph impact explanation edge evidence changed during rendering.");
    }
    const dependent = nodes[index_]!;
    const dependency = nodes[index_ - 1]!;
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
  index: SolveGraphQueryIndex,
  result: SolveGraphTraversalResult,
  options: SolveGraphImpactExplanationOptions = {},
): SolveGraphImpactExplanation {
  const entryById = assertResult(index, result);
  const maxRows = boundedMaxRows(options.maxRows);
  const impactedEntries = result.entries.filter((entry) => entry.depth > 0);
  const presentationTruncated = impactedEntries.length > maxRows;
  const visibleEntries = impactedEntries.slice(0, maxRows);
  const queryTruncated = result.truncated;
  const partial = queryTruncated || presentationTruncated;
  const roots = result.roots.map((root) => explainNode(index, root));

  const rows = visibleEntries.map((entry) => {
    const root = explainNode(index, entry.rootId);
    const node = explainNode(index, entry.id);
    const path = pathForEntry(index, entry, entryById);
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
  const queryNotice = impactNotice(result);
  if (queryNotice) notices.push(queryNotice);
  if (presentationTruncated) {
    notices.push("This explanation shows only the first bounded subset of impacted nodes returned by the query.");
  }

  const impactedNodes = impactedEntries.length;
  const maximumObservedDepth = result.entries.reduce((maximum, entry) => Math.max(maximum, entry.depth), 0);
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
    schema: "solvelang.solve-graph.impact-explanation.v0",
    mode: "analyze-only",
    graphId: index.document.graphId,
    direction: "dependents",
    status: partial ? "partial" : "complete",
    roots,
    headline,
    detail,
    rows,
    notices,
    summary: {
      rootCount: roots.length,
      queryEntries: result.entries.length,
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
