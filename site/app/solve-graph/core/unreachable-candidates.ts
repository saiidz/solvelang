import { traverseSolveGraph, type SolveGraphQueryIndex } from "./query-impact";

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_RESULTS = 200;
const DEFAULT_MAX_CANDIDATES = 30;
const HARD_MAX_CANDIDATES = 100;

type LocalUnreachedCandidateOptions = {
  maxDepth?: number;
  maxResults?: number;
  maxCandidates?: number;
};

function boundedCandidateLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > HARD_MAX_CANDIDATES) {
    throw new Error(
      `Solve Graph unreached-candidate maxCandidates must be an integer from 1 through ${HARD_MAX_CANDIDATES}.`,
    );
  }
  return value;
}

export function findLocalUnreachedCandidates(
  index: SolveGraphQueryIndex,
  entrypointIds: readonly string[],
  options: LocalUnreachedCandidateOptions = {},
) {
  if (
    index.document.mode !== "analyze-only" ||
    index.document.execution.networkAccess !== false ||
    index.document.execution.writeAccess !== false
  ) {
    throw new Error(
      "Solve Graph unreached-candidate analysis requires an analyze-only capability-free document.",
    );
  }

  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxCandidates = boundedCandidateLimit(options.maxCandidates ?? DEFAULT_MAX_CANDIDATES);
  const traversal = traverseSolveGraph(index, entrypointIds, "dependencies", {
    maxDepth,
    maxResults,
  });
  const reached = new Set(traversal.entries.map((entry) => entry.id));
  const candidates = index.document.nodes
    .filter((node) => !reached.has(node.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const visibleCandidates = candidates.slice(0, maxCandidates);
  const sourcePartial =
    index.document.execution.status === "partial" || index.document.execution.truncated;
  const queryTruncated = traversal.truncated;
  const presentationTruncated = candidates.length > visibleCandidates.length;
  const notices = [
    "Unreached nodes are static structural candidates in the observed local graph only; this does not establish runtime unreachability, dead code, or safety.",
    ...(sourcePartial
      ? [
          "The source graph is partial or truncated, so missing relationships may change observed reachability.",
        ]
      : []),
    ...(queryTruncated
      ? [
          "The bounded dependency traversal stopped early, so additional nodes may still be structurally reached.",
        ]
      : []),
    ...(presentationTruncated
      ? [
          `Showing ${visibleCandidates.length} of ${candidates.length} structural candidates because the panel is bounded.`,
        ]
      : []),
  ];

  return {
    entrypointIds: [...traversal.roots],
    candidates: visibleCandidates,
    summary: {
      matchedCandidates: candidates.length,
      returnedCandidates: visibleCandidates.length,
      hiddenCandidates: candidates.length - visibleCandidates.length,
    },
    sourcePartial,
    queryTruncated,
    presentationTruncated,
    truncated: sourcePartial || queryTruncated || presentationTruncated,
    notices,
    notice: notices.join(" "),
    execution: {
      networkAccess: false as const,
      writeAccess: false as const,
      maxDepth,
      maxResults,
      maxCandidates,
    },
  };
}
