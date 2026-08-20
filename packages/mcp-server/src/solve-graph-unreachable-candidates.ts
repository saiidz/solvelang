import {
  executeSolveGraphTool,
  type SolveGraphDocument,
  type SolveGraphEdgeKind,
} from "./solve-graph.js";
export function findSolveGraphUnreachableCandidates(
  document: SolveGraphDocument,
  entrypointIds: readonly string[],
  options: {
    edgeKinds?: readonly SolveGraphEdgeKind[];
    maxDepth?: number;
    maxResults?: number;
    maxCandidates?: number;
  } = {},
) {
  if (
    document.mode !== "analyze-only" ||
    document.execution.networkAccess !== false ||
    document.execution.writeAccess !== false
  )
    throw new Error(
      "Solve Graph unreachable-candidate analysis requires an analyze-only capability-free document.",
    );
  const maxCandidates = options.maxCandidates ?? 100;
  if (
    !Number.isSafeInteger(maxCandidates) ||
    maxCandidates < 1 ||
    maxCandidates > 100
  )
    throw new Error(
      "Solve Graph unreachable-candidate maxCandidates must be an integer from 1 through 100.",
    );
  const traversal = executeSolveGraphTool(document, {
    tool: "solve_graph.dependencies",
    rootIds: entrypointIds,
    options: {
      edgeKinds: options.edgeKinds,
      maxDepth: options.maxDepth ?? 8,
      maxResults: options.maxResults ?? 1000,
    },
  });
  if (traversal.tool !== "solve_graph.dependencies")
    throw new Error("Solve Graph unreachable-candidate traversal failed.");
  const reached = new Set(traversal.entries.map((entry) => entry.id));
  const candidates = document.nodes
    .filter((node) => !reached.has(node.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const visible = candidates
    .slice(0, maxCandidates)
    .map((node) => ({ id: node.id, kind: node.kind, label: node.label }));
  return {
    tool: "solve_graph.unreachable_candidates" as const,
    graphId: document.graphId,
    entrypointIds: [...traversal.roots],
    candidates: visible,
    summary: {
      matchedCandidates: candidates.length,
      returnedCandidates: visible.length,
      hiddenCandidates: candidates.length - visible.length,
    },
    truncated: traversal.truncated || candidates.length > visible.length,
    notices: [
      "Unreached nodes are static structural candidates only; this does not establish runtime unreachability, dead code, or safety.",
      ...(traversal.truncated
        ? [
            "The bounded traversal stopped early, so additional nodes may be structurally reached.",
          ]
        : []),
    ],
    execution: {
      networkAccess: false as const,
      writeAccess: false as const,
      maxDepth: options.maxDepth ?? 8,
      maxResults: options.maxResults ?? 1000,
      maxCandidates,
    },
  };
}
