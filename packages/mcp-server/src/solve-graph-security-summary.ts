import { SOLVE_GRAPH_TOOL_API_VERSION, type SolveGraphDocument, type SolveGraphEdgeKind, type SolveGraphNode, type SolveGraphToolNode } from "./solve-graph.js";

export const MAX_SOLVE_GRAPH_SECURITY_SUMMARY_ROWS = 100;
const securityNodeKinds = new Set(["permission", "resource", "route"]);
const securityEdgeKinds = new Set<SolveGraphEdgeKind>(["grants", "exposes", "deploys", "reads", "writes"]);

export type SolveGraphSecuritySummary = {
  apiVersion: typeof SOLVE_GRAPH_TOOL_API_VERSION;
  tool: "solve_graph.security_summary";
  graphId: string;
  nodes: SolveGraphToolNode[];
  relationships: Array<{ id: string; kind: SolveGraphEdgeKind; from: SolveGraphToolNode; to: SolveGraphToolNode }>;
  summary: { securityRelevantNodeCandidates: number; returnedNodes: number; hiddenNodes: number; securityRelevantRelationshipCandidates: number; returnedRelationships: number; hiddenRelationships: number };
  truncated: boolean;
  notices: string[];
  execution: { networkAccess: false; writeAccess: false; maxNodes: number; maxRelationships: number };
};

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function max(value: number | undefined, label: string): number { const resolved = value ?? MAX_SOLVE_GRAPH_SECURITY_SUMMARY_ROWS; if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_SOLVE_GRAPH_SECURITY_SUMMARY_ROWS) throw new Error(`${label} must be an integer from 1 through ${MAX_SOLVE_GRAPH_SECURITY_SUMMARY_ROWS}.`); return resolved; }
function safeNode(node: SolveGraphNode): SolveGraphToolNode { const path = node.metadata?.path; const packageName = node.metadata?.packageName; return { id: node.id, kind: node.kind, label: node.label, ...(typeof path === "string" ? { path } : {}), ...(typeof packageName === "string" ? { packageName } : {}) }; }

export function summarizeSolveGraphSecurity(document: SolveGraphDocument, options: { maxNodes?: number; maxRelationships?: number } = {}): SolveGraphSecuritySummary {
  if (document.mode !== "analyze-only" || document.execution.networkAccess !== false || document.execution.writeAccess !== false) throw new Error("Solve Graph security summary requires an analyze-only capability-free document.");
  const maxNodes = max(options.maxNodes, "Solve Graph security summary maxNodes"); const maxRelationships = max(options.maxRelationships, "Solve Graph security summary maxRelationships");
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const candidates = document.nodes.filter((node) => securityNodeKinds.has(node.kind)).sort((a, b) => compareText(a.id, b.id));
  const relationships = document.edges.filter((edge) => securityEdgeKinds.has(edge.kind)).sort((a, b) => compareText(a.id, b.id));
  const visibleNodes = candidates.slice(0, maxNodes).map(safeNode); const visibleRelationships = relationships.slice(0, maxRelationships).map((edge) => ({ id: edge.id, kind: edge.kind, from: safeNode(nodesById.get(edge.from)!), to: safeNode(nodesById.get(edge.to)!) }));
  const hiddenNodes = candidates.length - visibleNodes.length; const hiddenRelationships = relationships.length - visibleRelationships.length;
  return { apiVersion: SOLVE_GRAPH_TOOL_API_VERSION, tool: "solve_graph.security_summary", graphId: document.graphId, nodes: visibleNodes, relationships: visibleRelationships, summary: { securityRelevantNodeCandidates: candidates.length, returnedNodes: visibleNodes.length, hiddenNodes, securityRelevantRelationshipCandidates: relationships.length, returnedRelationships: visibleRelationships.length, hiddenRelationships }, truncated: hiddenNodes > 0 || hiddenRelationships > 0, notices: ["Security candidates are static graph evidence only, not a security audit, vulnerability finding, or authorization decision.", ...((hiddenNodes || hiddenRelationships) ? ["Additional candidate nodes or relationships were omitted by configured output bounds."] : [])], execution: { networkAccess: false, writeAccess: false, maxNodes, maxRelationships } };
}
