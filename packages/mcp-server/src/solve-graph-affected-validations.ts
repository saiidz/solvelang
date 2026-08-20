import {
  defaultSolveGraphImpactEdgeKinds,
  executeSolveGraphTool,
  SOLVE_GRAPH_TOOL_API_VERSION,
  solveGraphEdgeKinds,
  type SolveGraphDocument,
  type SolveGraphEdgeKind,
  type SolveGraphNode,
  type SolveGraphToolNode,
} from "./solve-graph.js";

export const MAX_SOLVE_GRAPH_AFFECTED_VALIDATIONS = 100;

export type SolveGraphAffectedValidationOptions = {
  edgeKinds?: readonly SolveGraphEdgeKind[];
  maxDepth?: number;
  maxResults?: number;
  maxValidations?: number;
};

export type SolveGraphAffectedValidationResponse = {
  apiVersion: typeof SOLVE_GRAPH_TOOL_API_VERSION;
  tool: "solve_graph.affected_validations";
  graphId: string;
  roots: string[];
  validations: Array<{
    id: string;
    depth: number;
    rootId: string;
    parentId?: string;
    viaEdgeId?: string;
    viaEdgeKind?: SolveGraphEdgeKind;
    node: SolveGraphToolNode;
  }>;
  summary: {
    matchedValidationCandidates: number;
    returnedValidationCandidates: number;
    hiddenValidationCandidates: number;
  };
  truncated: boolean;
  queryTruncated: boolean;
  presentationTruncated: boolean;
  notices: string[];
  execution: {
    networkAccess: false;
    writeAccess: false;
    edgeKinds: SolveGraphEdgeKind[];
    maxDepth: number;
    maxResults: number;
    maxValidations: number;
  };
};

const validationNodeKinds = new Set(["test", "workflow", "job"]);
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
  for (const value of unique) if (!edgeKindSet.has(value)) throw new Error(`Solve Graph affected-validation edge kind is invalid: ${value}`);
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
    throw new Error("Solve Graph affected-validation analysis requires an analyze-only capability-free document.");
  }
}

type SolveGraphImpactResponse = {
  tool: "solve_graph.impact";
  roots: string[];
  entries: Array<{
    id: string;
    depth: number;
    rootId: string;
    parentId?: string;
    viaEdgeId?: string;
    viaEdgeKind?: SolveGraphEdgeKind;
    node: SolveGraphToolNode;
  }>;
  truncated: boolean;
  truncationReason?: "depth" | "result-count";
};

function impactResponse(document: SolveGraphDocument, roots: readonly string[], options: { edgeKinds: SolveGraphEdgeKind[]; maxDepth: number; maxResults: number }): SolveGraphImpactResponse {
  const response = executeSolveGraphTool(document, {
    tool: "solve_graph.impact",
    changedNodeIds: roots,
    options,
  });
  if (response.tool !== "solve_graph.impact") throw new Error("Solve Graph affected-validation analysis received an invalid impact response.");
  return { ...response, tool: "solve_graph.impact" };
}

export function findSolveGraphAffectedValidations(
  document: SolveGraphDocument,
  changedNodeIds: readonly string[],
  options: SolveGraphAffectedValidationOptions = {},
): SolveGraphAffectedValidationResponse {
  assertCapabilityFreeDocument(document);
  const edgeKinds = normalizedEdgeKinds(options.edgeKinds);
  const maxDepth = boundedInteger(options.maxDepth, 4, 0, 64, "Solve Graph affected-validation maxDepth");
  const maxResults = boundedInteger(options.maxResults, 1_000, 1, 10_000, "Solve Graph affected-validation maxResults");
  const maxValidations = boundedInteger(options.maxValidations, 100, 1, MAX_SOLVE_GRAPH_AFFECTED_VALIDATIONS, "Solve Graph affected-validation maxValidations");
  const impact = impactResponse(document, changedNodeIds, { edgeKinds, maxDepth, maxResults });
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const candidates = impact.entries
    .filter((entry) => validationNodeKinds.has(entry.node.kind))
    .sort((left, right) => left.depth - right.depth || compareText(left.rootId, right.rootId) || compareText(left.id, right.id));
  const visible = candidates.slice(0, maxValidations);
  const presentationTruncated = candidates.length > visible.length;
  const queryTruncated = impact.truncated;
  const truncated = queryTruncated || presentationTruncated;

  return {
    apiVersion: SOLVE_GRAPH_TOOL_API_VERSION,
    tool: "solve_graph.affected_validations",
    graphId: document.graphId,
    roots: impact.roots,
    validations: visible.map((entry) => ({
      id: entry.id,
      depth: entry.depth,
      rootId: entry.rootId,
      ...(entry.parentId ? { parentId: entry.parentId } : {}),
      ...(entry.viaEdgeId ? { viaEdgeId: entry.viaEdgeId } : {}),
      ...(entry.viaEdgeKind ? { viaEdgeKind: entry.viaEdgeKind } : {}),
      node: safeNode(nodesById.get(entry.id)!),
    })),
    summary: {
      matchedValidationCandidates: candidates.length,
      returnedValidationCandidates: visible.length,
      hiddenValidationCandidates: candidates.length - visible.length,
    },
    truncated,
    queryTruncated,
    presentationTruncated,
    notices: [
      "Affected validations are structural candidate evidence only; graph extraction may omit validations or runtime selection conditions.",
      ...(queryTruncated ? [`Impact traversal reached the configured ${impact.truncationReason === "depth" ? "depth" : "result-count"} bound; additional validation candidates may exist.`] : []),
      ...(presentationTruncated ? ["Additional matched validation candidates were omitted by the validation-output bound."] : []),
    ],
    execution: { networkAccess: false, writeAccess: false, edgeKinds, maxDepth, maxResults, maxValidations },
  };
}
