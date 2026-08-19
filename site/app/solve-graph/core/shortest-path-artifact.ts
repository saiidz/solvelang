import { sha256Hex } from "../../repository-audit/core/ingestion";
import { canonicalSolveGraphJson } from "./canonical";
import type { SolveGraphQueryIndex } from "./query-impact";
import type { SolveGraphShortestPathResult } from "./shortest-path";

export type SolveGraphShortestPathArtifact = {
  schema: "solvelang.solve-graph.shortest-path-artifact.v1";
  schemaVersion: "1.0.0";
  mode: "analyze-only";
  graphId: string;
  direction: SolveGraphShortestPathResult["direction"];
  sourceId: string;
  targetId: string;
  found: boolean;
  nodeIds: string[];
  hops: SolveGraphShortestPathResult["hops"];
  visitedCount: number;
  truncated: boolean;
  truncationReason?: SolveGraphShortestPathResult["truncationReason"];
  execution: {
    networkAccess: false;
    writeAccess: false;
  };
  integrity: {
    canonicalJsonSha256: string;
  };
};

export type SolveGraphShortestPathDownload = {
  filename: string;
  mediaType: "application/json;charset=utf-8";
  content: string;
  artifact: SolveGraphShortestPathArtifact;
};

const encoder = new TextEncoder();

function assertResult(index: SolveGraphQueryIndex, result: SolveGraphShortestPathResult): void {
  if (!index.nodesById.has(result.sourceId)) {
    throw new Error("Solve Graph shortest-path artifact source does not exist in the query graph.");
  }
  if (!index.nodesById.has(result.targetId)) {
    throw new Error("Solve Graph shortest-path artifact target does not exist in the query graph.");
  }
  if (result.direction !== "dependencies" && result.direction !== "dependents") {
    throw new Error("Solve Graph shortest-path artifact direction is invalid.");
  }
  if (!Number.isSafeInteger(result.visitedCount) || result.visitedCount < 1 || result.visitedCount > 10_000) {
    throw new Error("Solve Graph shortest-path artifact visitedCount is invalid.");
  }
  if (result.truncationReason !== undefined
    && result.truncationReason !== "depth"
    && result.truncationReason !== "visited-count") {
    throw new Error("Solve Graph shortest-path artifact truncation reason is invalid.");
  }
  if (result.truncated !== (result.truncationReason !== undefined)) {
    throw new Error("Solve Graph shortest-path artifact truncation metadata is inconsistent.");
  }

  if (!result.found) {
    if (result.nodeIds.length !== 0 || result.hops.length !== 0) {
      throw new Error("Solve Graph shortest-path artifact must not contain a path when found=false.");
    }
    if (result.sourceId === result.targetId) {
      throw new Error("Solve Graph shortest-path artifact cannot report found=false for identical endpoints.");
    }
    return;
  }

  if (result.truncated) {
    throw new Error("Solve Graph shortest-path artifact cannot mark a found path as truncated.");
  }
  if (result.nodeIds.length !== result.hops.length + 1 || result.nodeIds.length === 0) {
    throw new Error("Solve Graph shortest-path artifact path shape is invalid.");
  }
  if (result.nodeIds[0] !== result.sourceId || result.nodeIds[result.nodeIds.length - 1] !== result.targetId) {
    throw new Error("Solve Graph shortest-path artifact path endpoints do not match the query.");
  }
  if (new Set(result.nodeIds).size !== result.nodeIds.length) {
    throw new Error("Solve Graph shortest-path artifact path must be simple and cycle-free.");
  }
  if (result.visitedCount < result.nodeIds.length) {
    throw new Error("Solve Graph shortest-path artifact visitedCount cannot be smaller than the returned path.");
  }

  const edgesById = new Map(index.document.edges.map((edge) => [edge.id, edge] as const));
  result.nodeIds.forEach((nodeId) => {
    if (!index.nodesById.has(nodeId)) {
      throw new Error("Solve Graph shortest-path artifact references a missing node.");
    }
  });
  result.hops.forEach((hop, hopIndex) => {
    if (hop.from !== result.nodeIds[hopIndex] || hop.to !== result.nodeIds[hopIndex + 1]) {
      throw new Error("Solve Graph shortest-path artifact hop orientation does not match its path.");
    }
    const edge = edgesById.get(hop.edgeId);
    if (!edge || edge.kind !== hop.edgeKind) {
      throw new Error("Solve Graph shortest-path artifact references a missing or mismatched edge.");
    }
    const oriented = result.direction === "dependencies"
      ? edge.from === hop.from && edge.to === hop.to
      : edge.to === hop.from && edge.from === hop.to;
    if (!oriented) {
      throw new Error("Solve Graph shortest-path artifact edge orientation does not match the traversal direction.");
    }
  });
}

function safeFilename(value: string): string {
  const normalized = value
    .normalize("NFC")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const stem = normalized.replace(/\.[A-Za-z0-9]{1,8}$/, "").slice(0, 96);
  return stem || "solve-graph";
}

export async function createSolveGraphShortestPathArtifact(
  index: SolveGraphQueryIndex,
  result: SolveGraphShortestPathResult,
): Promise<SolveGraphShortestPathArtifact> {
  assertResult(index, result);
  const withoutIntegrity = {
    schema: "solvelang.solve-graph.shortest-path-artifact.v1" as const,
    schemaVersion: "1.0.0" as const,
    mode: "analyze-only" as const,
    graphId: index.document.graphId,
    direction: result.direction,
    sourceId: result.sourceId,
    targetId: result.targetId,
    found: result.found,
    nodeIds: [...result.nodeIds],
    hops: result.hops.map((hop) => ({ ...hop })),
    visitedCount: result.visitedCount,
    truncated: result.truncated,
    ...(result.truncationReason === undefined ? {} : { truncationReason: result.truncationReason }),
    execution: {
      networkAccess: false as const,
      writeAccess: false as const,
    },
  };
  const canonicalJsonSha256 = await sha256Hex(encoder.encode(canonicalSolveGraphJson(withoutIntegrity)));
  return {
    ...withoutIntegrity,
    integrity: { canonicalJsonSha256 },
  };
}

export function serializeSolveGraphShortestPathArtifact(artifact: SolveGraphShortestPathArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export async function createSolveGraphShortestPathDownload(
  sourceName: string,
  index: SolveGraphQueryIndex,
  result: SolveGraphShortestPathResult,
): Promise<SolveGraphShortestPathDownload> {
  const artifact = await createSolveGraphShortestPathArtifact(index, result);
  return {
    filename: `${safeFilename(sourceName)}-solvelang-shortest-path.json`,
    mediaType: "application/json;charset=utf-8",
    content: serializeSolveGraphShortestPathArtifact(artifact),
    artifact,
  };
}
