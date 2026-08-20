import { traverseSolveGraph, type SolveGraphQueryIndex } from "./query-impact";
export function findLocalUnreachedCandidates(index: SolveGraphQueryIndex, entrypointIds: readonly string[], maxCandidates = 30) {
  const traversal = traverseSolveGraph(index, entrypointIds, "dependencies", { maxDepth: 8, maxResults: 200 });
  const reached = new Set(traversal.entries.map((entry) => entry.id));
  const candidates = index.document.nodes.filter((node) => !reached.has(node.id)).sort((a, b) => a.id.localeCompare(b.id));
  return { candidates: candidates.slice(0, maxCandidates), truncated: traversal.truncated || candidates.length > maxCandidates, notice: "Unreached nodes are static local graph candidates only; they do not establish runtime unreachability or dead code." };
}
