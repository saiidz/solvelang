import { sha256Hex } from "../../repository-audit/core/ingestion";
import { canonicalSolveGraphJson } from "./canonical";
import type { SolveGraphAlternativePathsResult } from "./alternative-paths";
import type { SolveGraphQueryIndex } from "./query-impact";

export type SolveGraphAlternativePathsArtifact = {
  schema: "solvelang.solve-graph.alternative-paths-artifact.v1";
  schemaVersion: "1.0.0";
  mode: "analyze-only";
  graphId: string;
  direction: SolveGraphAlternativePathsResult["direction"];
  sourceId: string;
  targetId: string;
  paths: SolveGraphAlternativePathsResult["paths"];
  statesCreated: number;
  truncated: boolean;
  truncationReason?: SolveGraphAlternativePathsResult["truncationReason"];
  execution: {
    networkAccess: false;
    writeAccess: false;
  };
  integrity: {
    canonicalJsonSha256: string;
  };
};

export type SolveGraphAlternativePathsDownload = {
  filename: string;
  mediaType: "application/json;charset=utf-8";
  content: string;
  artifact: SolveGraphAlternativePathsArtifact;
};

const encoder = new TextEncoder();

function assertResult(index: SolveGraphQueryIndex, result: SolveGraphAlternativePathsResult): void {
  if (!index.nodesById.has(result.sourceId)) {
    throw new Error("Solve Graph alternative-path artifact source does not exist in the query graph.");
  }
  if (!index.nodesById.has(result.targetId)) {
    throw new Error("Solve Graph alternative-path artifact target does not exist in the query graph.");
  }
  if (result.direction !== "dependencies" && result.direction !== "dependents") {
    throw new Error("Solve Graph alternative-path artifact direction is invalid.");
  }
  if (!Number.isSafeInteger(result.statesCreated) || result.statesCreated < 1 || result.statesCreated > 50_000) {
    throw new Error("Solve Graph alternative-path artifact statesCreated is invalid.");
  }
  if (result.paths.length > 64) {
    throw new Error("Solve Graph alternative-path artifact exceeds the query path bound.");
  }
  if (result.truncationReason !== undefined
    && result.truncationReason !== "depth"
    && result.truncationReason !== "path-count"
    && result.truncationReason !== "state-count") {
    throw new Error("Solve Graph alternative-path artifact truncation reason is invalid.");
  }
  if (result.truncated !== (result.truncationReason !== undefined)) {
    throw new Error("Solve Graph alternative-path artifact truncation metadata is inconsistent.");
  }

  const edgesById = new Map(index.document.edges.map((edge) => [edge.id, edge] as const));
  const seenPaths = new Set<string>();
  for (const path of result.paths) {
    if (path.nodeIds.length !== path.hops.length + 1 || path.nodeIds.length === 0) {
      throw new Error("Solve Graph alternative-path artifact path shape is invalid.");
    }
    if (path.nodeIds[0] !== result.sourceId || path.nodeIds[path.nodeIds.length - 1] !== result.targetId) {
      throw new Error("Solve Graph alternative-path artifact path endpoints do not match the query.");
    }
    if (new Set(path.nodeIds).size !== path.nodeIds.length) {
      throw new Error("Solve Graph alternative-path artifact paths must remain simple and cycle-free.");
    }
    for (const nodeId of path.nodeIds) {
      if (!index.nodesById.has(nodeId)) {
        throw new Error("Solve Graph alternative-path artifact references a missing node.");
      }
    }
    path.hops.forEach((hop, hopIndex) => {
      if (hop.from !== path.nodeIds[hopIndex] || hop.to !== path.nodeIds[hopIndex + 1]) {
        throw new Error("Solve Graph alternative-path artifact hop orientation does not match its path.");
      }
      const edge = edgesById.get(hop.edgeId);
      if (!edge || edge.kind !== hop.edgeKind) {
        throw new Error("Solve Graph alternative-path artifact references a missing or mismatched edge.");
      }
      const oriented = result.direction === "dependencies"
        ? edge.from === hop.from && edge.to === hop.to
        : edge.to === hop.from && edge.from === hop.to;
      if (!oriented) {
        throw new Error("Solve Graph alternative-path artifact edge orientation does not match the traversal direction.");
      }
    });
    const key = canonicalSolveGraphJson(path);
    if (seenPaths.has(key)) {
      throw new Error("Solve Graph alternative-path artifact contains duplicate paths.");
    }
    seenPaths.add(key);
  }
}

function safeFilename(value: string): string {
  const normalized = value.normalize("NFC").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const stem = normalized.replace(/\.[A-Za-z0-9]{1,8}$/, "").slice(0, 96);
  return stem || "solve-graph";
}

export async function createSolveGraphAlternativePathsArtifact(
  index: SolveGraphQueryIndex,
  result: SolveGraphAlternativePathsResult,
): Promise<SolveGraphAlternativePathsArtifact> {
  assertResult(index, result);
  const withoutIntegrity = {
    schema: "solvelang.solve-graph.alternative-paths-artifact.v1" as const,
    schemaVersion: "1.0.0" as const,
    mode: "analyze-only" as const,
    graphId: index.document.graphId,
    direction: result.direction,
    sourceId: result.sourceId,
    targetId: result.targetId,
    paths: result.paths.map((path) => ({
      nodeIds: [...path.nodeIds],
      hops: path.hops.map((hop) => ({ ...hop })),
    })),
    statesCreated: result.statesCreated,
    truncated: result.truncated,
    ...(result.truncationReason === undefined ? {} : { truncationReason: result.truncationReason }),
    execution: { networkAccess: false as const, writeAccess: false as const },
  };
  const canonicalJsonSha256 = await sha256Hex(encoder.encode(canonicalSolveGraphJson(withoutIntegrity)));
  return { ...withoutIntegrity, integrity: { canonicalJsonSha256 } };
}

export function serializeSolveGraphAlternativePathsArtifact(artifact: SolveGraphAlternativePathsArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export async function createSolveGraphAlternativePathsDownload(
  sourceName: string,
  index: SolveGraphQueryIndex,
  result: SolveGraphAlternativePathsResult,
): Promise<SolveGraphAlternativePathsDownload> {
  const artifact = await createSolveGraphAlternativePathsArtifact(index, result);
  return {
    filename: `${safeFilename(sourceName)}-solvelang-alternative-paths.json`,
    mediaType: "application/json;charset=utf-8",
    content: serializeSolveGraphAlternativePathsArtifact(artifact),
    artifact,
  };
}
