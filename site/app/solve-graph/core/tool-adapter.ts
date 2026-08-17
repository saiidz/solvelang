import { canonicalSolveGraphJson } from "./canonical";
import type { SolveGraphDocument, SolveGraphEdgeKind, SolveGraphNodeKind } from "./contracts";
import {
  analyzeSolveGraphImpact,
  createSolveGraphQueryIndex,
  findSolveGraphNodes,
  traverseSolveGraph,
  type SolveGraphNodeQuery,
  type SolveGraphQueryIndex,
  type SolveGraphTraversalOptions,
  type SolveGraphTraversalResult,
} from "./query-impact";

export const SOLVE_GRAPH_TOOL_API_VERSION = "1.0.0";
export const solveGraphToolNames = Object.freeze([
  "solve_graph.find_nodes",
  "solve_graph.dependencies",
  "solve_graph.dependents",
  "solve_graph.impact",
] as const);

export type SolveGraphToolName = (typeof solveGraphToolNames)[number];

export type SolveGraphToolRequest =
  | { tool: "solve_graph.find_nodes"; query?: SolveGraphNodeQuery }
  | { tool: "solve_graph.dependencies"; rootIds: readonly string[]; options?: SolveGraphTraversalOptions }
  | { tool: "solve_graph.dependents"; rootIds: readonly string[]; options?: SolveGraphTraversalOptions }
  | { tool: "solve_graph.impact"; changedNodeIds: readonly string[]; options?: SolveGraphTraversalOptions };

export type SolveGraphToolNode = {
  id: string;
  kind: SolveGraphNodeKind;
  label: string;
  path?: string;
  packageName?: string;
};

export type SolveGraphToolTraversalEntry = {
  id: string;
  depth: number;
  rootId: string;
  parentId?: string;
  viaEdgeId?: string;
  viaEdgeKind?: SolveGraphEdgeKind;
  node: SolveGraphToolNode;
};

export type SolveGraphFindNodesResponse = {
  apiVersion: typeof SOLVE_GRAPH_TOOL_API_VERSION;
  tool: "solve_graph.find_nodes";
  graphId: string;
  nodes: SolveGraphToolNode[];
  truncated: boolean;
};

export type SolveGraphTraversalResponse = {
  apiVersion: typeof SOLVE_GRAPH_TOOL_API_VERSION;
  tool: "solve_graph.dependencies" | "solve_graph.dependents" | "solve_graph.impact";
  graphId: string;
  roots: string[];
  entries: SolveGraphToolTraversalEntry[];
  truncated: boolean;
  truncationReason?: "depth" | "result-count";
};

export type SolveGraphToolResponse = SolveGraphFindNodesResponse | SolveGraphTraversalResponse;

const MAX_TOOL_ROOTS = 128;
const NODE_ID_PATTERN = /^sgn_[a-f0-9]{32}$/;
const toolNameSet = new Set<string>(solveGraphToolNames);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireTool(value: unknown): SolveGraphToolName {
  if (typeof value !== "string" || !toolNameSet.has(value)) {
    throw new Error(`Solve Graph tool is invalid: ${String(value)}`);
  }
  return value as SolveGraphToolName;
}

function requireRootIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Solve Graph ${label} must be a non-empty array.`);
  }
  if (value.length > MAX_TOOL_ROOTS) throw new Error(`Solve Graph ${label} exceeds ${MAX_TOOL_ROOTS} roots.`);
  const roots = value.map((item) => {
    if (typeof item !== "string" || !NODE_ID_PATTERN.test(item)) {
      throw new Error(`Solve Graph ${label} contains an invalid node ID.`);
    }
    return item;
  });
  return [...new Set(roots)].sort(compareText);
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`Solve Graph ${label} must be an object.`);
  return value;
}

function safeNode(index: SolveGraphQueryIndex, id: string): SolveGraphToolNode {
  const node = index.nodesById.get(id);
  if (!node) throw new Error(`Solve Graph tool response references missing node: ${id}`);
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

function traversalResponse(
  index: SolveGraphQueryIndex,
  tool: SolveGraphTraversalResponse["tool"],
  result: SolveGraphTraversalResult,
): SolveGraphTraversalResponse {
  const edgesById = new Map(index.document.edges.map((edge) => [edge.id, edge]));
  return {
    apiVersion: SOLVE_GRAPH_TOOL_API_VERSION,
    tool,
    graphId: index.document.graphId,
    roots: [...result.roots],
    entries: result.entries.map((entry) => {
      const edge = entry.viaEdgeId ? edgesById.get(entry.viaEdgeId) : undefined;
      return {
        id: entry.id,
        depth: entry.depth,
        rootId: entry.rootId,
        ...(entry.parentId ? { parentId: entry.parentId } : {}),
        ...(entry.viaEdgeId ? { viaEdgeId: entry.viaEdgeId } : {}),
        ...(edge ? { viaEdgeKind: edge.kind } : {}),
        node: safeNode(index, entry.id),
      };
    }),
    truncated: result.truncated,
    ...(result.truncationReason ? { truncationReason: result.truncationReason } : {}),
  };
}

export function parseSolveGraphToolRequest(value: unknown): SolveGraphToolRequest {
  if (!isRecord(value)) throw new Error("Solve Graph tool request must be an object.");
  const tool = requireTool(value.tool);

  if (tool === "solve_graph.find_nodes") {
    const query = optionalRecord(value.query, "find_nodes query");
    return { tool, ...(query ? { query: query as SolveGraphNodeQuery } : {}) };
  }

  const options = optionalRecord(value.options, "traversal options") as SolveGraphTraversalOptions | undefined;
  if (tool === "solve_graph.impact") {
    return { tool, changedNodeIds: requireRootIds(value.changedNodeIds, "changedNodeIds"), ...(options ? { options } : {}) };
  }
  return { tool, rootIds: requireRootIds(value.rootIds, "rootIds"), ...(options ? { options } : {}) };
}

export function executeSolveGraphTool(index: SolveGraphQueryIndex, input: SolveGraphToolRequest | unknown): SolveGraphToolResponse {
  const request = parseSolveGraphToolRequest(input);
  if (request.tool === "solve_graph.find_nodes") {
    const query = request.query ?? {};
    const nodes = findSolveGraphNodes(index, query).map((node) => safeNode(index, node.id));
    const requestedLimit = typeof query.limit === "number" ? query.limit : 100;
    return {
      apiVersion: SOLVE_GRAPH_TOOL_API_VERSION,
      tool: request.tool,
      graphId: index.document.graphId,
      nodes,
      truncated: nodes.length >= requestedLimit && index.document.nodes.length > nodes.length,
    };
  }

  if (request.tool === "solve_graph.dependencies") {
    return traversalResponse(index, request.tool, traverseSolveGraph(index, request.rootIds, "dependencies", request.options));
  }
  if (request.tool === "solve_graph.dependents") {
    return traversalResponse(index, request.tool, traverseSolveGraph(index, request.rootIds, "dependents", request.options));
  }
  return traversalResponse(index, request.tool, analyzeSolveGraphImpact(index, request.changedNodeIds, request.options));
}

export async function executeSolveGraphToolOnDocument(
  document: SolveGraphDocument,
  request: SolveGraphToolRequest | unknown,
): Promise<SolveGraphToolResponse> {
  return executeSolveGraphTool(await createSolveGraphQueryIndex(document), request);
}

export function serializeSolveGraphToolResponse(response: SolveGraphToolResponse): string {
  return canonicalSolveGraphJson(response);
}
