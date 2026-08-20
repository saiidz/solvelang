import { SOLVE_GRAPH_TOOL_API_VERSION, type SolveGraphDocument, type SolveGraphEdgeKind, type SolveGraphNode, type SolveGraphToolNode } from "./solve-graph.js";
export const MAX_SOLVE_GRAPH_ENTRYPOINTS = 100;
const nodeKinds = new Set(["route", "workflow", "job"]);
function safe(node: SolveGraphNode): SolveGraphToolNode { const path = node.metadata?.path; return { id: node.id, kind: node.kind, label: node.label, ...(typeof path === "string" ? { path } : {}) }; }
export function findSolveGraphEntrypointCandidates(document: SolveGraphDocument, options: { maxCandidates?: number } = {}) {
  if (document.mode !== "analyze-only" || document.execution.networkAccess !== false || document.execution.writeAccess !== false) throw new Error("Solve Graph entrypoint analysis requires an analyze-only capability-free document.");
  const maxCandidates = options.maxCandidates ?? 50; if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > MAX_SOLVE_GRAPH_ENTRYPOINTS) throw new Error(`Solve Graph entrypoint maxCandidates must be an integer from 1 through ${MAX_SOLVE_GRAPH_ENTRYPOINTS}.`);
  const exposed = new Set(document.edges.filter((edge) => edge.kind === "exposes").flatMap((edge) => [edge.from, edge.to]));
  const candidates = document.nodes.filter((node) => nodeKinds.has(node.kind) || exposed.has(node.id)).sort((a, b) => a.id.localeCompare(b.id)); const visible = candidates.slice(0, maxCandidates);
  return { apiVersion: SOLVE_GRAPH_TOOL_API_VERSION, tool: "solve_graph.entrypoint_candidates" as const, graphId: document.graphId, candidates: visible.map(safe), summary: { matchedCandidates: candidates.length, returnedCandidates: visible.length, hiddenCandidates: candidates.length - visible.length }, truncated: candidates.length > visible.length, notices: ["Entrypoints are static structural candidates only; this does not establish runtime reachability, invocation frequency, or public exposure.", ...(candidates.length > visible.length ? ["Additional candidate entrypoints were omitted by the output bound."] : [])], execution: { networkAccess: false as const, writeAccess: false as const, maxCandidates } };
}
