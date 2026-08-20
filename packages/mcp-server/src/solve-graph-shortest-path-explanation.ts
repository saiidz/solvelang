import {
  findSolveGraphShortestPath,
  type SolveGraphShortestPathOptions,
  type SolveGraphShortestPathResponse,
} from "./solve-graph-shortest-path.js";
import type { SolveGraphDocument } from "./solve-graph.js";

const MAX_EXPLANATION_HOPS = 64;

export type SolveGraphShortestPathExplanationStep = {
  index: number;
  edgeId: string;
  edgeKind: SolveGraphShortestPathResponse["hops"][number]["edgeKind"];
  from: SolveGraphShortestPathResponse["nodes"][number];
  to: SolveGraphShortestPathResponse["nodes"][number];
  sentence: string;
};

export type SolveGraphShortestPathExplanation = {
  schema: "solvelang.mcp.solve-graph.shortest-path-explanation.v0";
  mode: "analyze-only";
  graphId: string;
  direction: SolveGraphShortestPathResponse["direction"];
  sourceId: string;
  targetId: string;
  found: boolean;
  status: "complete" | "partial";
  headline: string;
  detail: string;
  steps: SolveGraphShortestPathExplanationStep[];
  notices: string[];
  summary: {
    hopCount: number;
    visitedCount: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    queryTruncated: boolean;
  };
};

function assertResponse(response: SolveGraphShortestPathResponse): void {
  if (response.tool !== "solve_graph.shortest_path") {
    throw new Error("Solve Graph shortest-path explanation requires a shortest-path response.");
  }
  if (response.execution.networkAccess !== false || response.execution.writeAccess !== false) {
    throw new Error("Solve Graph shortest-path explanation requires capability-free input.");
  }
  if (!Number.isSafeInteger(response.visitedCount)
    || response.visitedCount < 1
    || response.visitedCount > response.execution.maxVisited) {
    throw new Error("Solve Graph shortest-path explanation received invalid visitedCount truth.");
  }
  if (!Number.isSafeInteger(response.execution.maxDepth)
    || response.execution.maxDepth < 0
    || response.execution.maxDepth > 64
    || !Number.isSafeInteger(response.execution.maxVisited)
    || response.execution.maxVisited < 1
    || response.execution.maxVisited > 10_000) {
    throw new Error("Solve Graph shortest-path explanation received invalid query bounds.");
  }
  if (response.truncated !== (response.truncationReason !== undefined)) {
    throw new Error("Solve Graph shortest-path explanation received inconsistent truncation truth.");
  }
  if (response.truncationReason !== undefined
    && response.truncationReason !== "depth"
    && response.truncationReason !== "visited-count") {
    throw new Error("Solve Graph shortest-path explanation received an invalid truncation reason.");
  }

  if (!response.found) {
    if (response.nodes.length !== 0 || response.hops.length !== 0) {
      throw new Error("Solve Graph shortest-path explanation cannot explain path steps when found=false.");
    }
    if (response.sourceId === response.targetId) {
      throw new Error("Solve Graph shortest-path explanation cannot report no path for identical endpoints.");
    }
    return;
  }

  if (response.truncated) {
    throw new Error("Solve Graph shortest-path explanation cannot mark a found path as partial.");
  }
  if (response.nodes.length !== response.hops.length + 1 || response.nodes.length === 0) {
    throw new Error("Solve Graph shortest-path explanation received an invalid found-path shape.");
  }
  if (response.hops.length > MAX_EXPLANATION_HOPS) {
    throw new Error(`Solve Graph shortest-path explanation exceeds ${MAX_EXPLANATION_HOPS} hops.`);
  }
  if (response.nodes[0]!.id !== response.sourceId
    || response.nodes[response.nodes.length - 1]!.id !== response.targetId) {
    throw new Error("Solve Graph shortest-path explanation received invalid path endpoints.");
  }
  if (new Set(response.nodes.map((node) => node.id)).size !== response.nodes.length) {
    throw new Error("Solve Graph shortest-path explanation requires a simple cycle-free path.");
  }

  response.hops.forEach((hop, index) => {
    const from = response.nodes[index];
    const to = response.nodes[index + 1];
    if (!from
      || !to
      || hop.traversalFromId !== from.id
      || hop.traversalToId !== to.id) {
      throw new Error("Solve Graph shortest-path explanation received mismatched traversal evidence.");
    }
    const underlyingMatches = response.direction === "dependencies"
      ? hop.edgeFromId === from.id && hop.edgeToId === to.id
      : hop.edgeToId === from.id && hop.edgeFromId === to.id;
    if (!underlyingMatches) {
      throw new Error("Solve Graph shortest-path explanation received mismatched edge orientation.");
    }
  });
}

function headline(response: SolveGraphShortestPathResponse): string {
  if (response.found && response.sourceId === response.targetId) return "Source and target are the same node";
  if (response.found) return response.direction === "dependencies" ? "Dependency path found" : "Dependent path found";
  if (response.truncated) {
    return response.direction === "dependencies" ? "Dependency path search incomplete" : "Dependent path search incomplete";
  }
  return response.direction === "dependencies" ? "No dependency path found" : "No dependent path found";
}

function detail(response: SolveGraphShortestPathResponse): string {
  const hopCount = response.hops.length;
  if (response.found && hopCount === 0) {
    return `The query resolved immediately after visiting ${response.visitedCount} node.`;
  }
  if (response.found) {
    return `The shortest observed path contains ${hopCount} hop${hopCount === 1 ? "" : "s"} after visiting ${response.visitedCount} node${response.visitedCount === 1 ? "" : "s"}.`;
  }
  if (response.truncated) {
    return `No path was established before the bounded search stopped after visiting ${response.visitedCount} node${response.visitedCount === 1 ? "" : "s"}; absence is not proven.`;
  }
  return `No path exists within the completely searched configured graph scope after visiting ${response.visitedCount} node${response.visitedCount === 1 ? "" : "s"}.`;
}

function notices(response: SolveGraphShortestPathResponse): string[] {
  if (response.truncationReason === "depth") {
    return ["Shortest-path search reached the configured depth bound; a path may exist beyond the observed search depth."];
  }
  if (response.truncationReason === "visited-count") {
    return ["Shortest-path search reached the configured visited-node bound; a path may exist outside the observed search set."];
  }
  if (!response.found) {
    return ["No path was found within a complete search of the configured graph scope and edge filters."];
  }
  return [];
}

export function createSolveGraphShortestPathExplanation(
  response: SolveGraphShortestPathResponse,
): SolveGraphShortestPathExplanation {
  assertResponse(response);

  return {
    schema: "solvelang.mcp.solve-graph.shortest-path-explanation.v0",
    mode: "analyze-only",
    graphId: response.graphId,
    direction: response.direction,
    sourceId: response.sourceId,
    targetId: response.targetId,
    found: response.found,
    status: response.truncated ? "partial" : "complete",
    headline: headline(response),
    detail: detail(response),
    steps: response.hops.map((hop, index) => {
      const from = { ...response.nodes[index]! };
      const to = { ...response.nodes[index + 1]! };
      return {
        index: index + 1,
        edgeId: hop.edgeId,
        edgeKind: hop.edgeKind,
        from,
        to,
        sentence: `${from.label} --${hop.edgeKind}--> ${to.label}`,
      };
    }),
    notices: notices(response),
    summary: {
      hopCount: response.hops.length,
      visitedCount: response.visitedCount,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      queryTruncated: response.truncated,
    },
  };
}

export function explainSolveGraphShortestPath(
  document: SolveGraphDocument,
  sourceId: string,
  targetId: string,
  options: SolveGraphShortestPathOptions = {},
): SolveGraphShortestPathExplanation {
  return createSolveGraphShortestPathExplanation(
    findSolveGraphShortestPath(document, sourceId, targetId, options),
  );
}
