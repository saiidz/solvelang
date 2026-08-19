import { canonicalSolveGraphJson } from "./canonical";
import type { SolveGraphQueryIndex } from "./query-impact";
import type { SolveGraphShortestPathResult } from "./shortest-path";
import {
  verifySolveGraphShortestPathArtifact,
} from "./shortest-path-artifact-verify";
import {
  createSolveGraphShortestPathProductBundle,
  type SolveGraphShortestPathProductBundle,
} from "./shortest-path-product";

export const MAX_SOLVE_GRAPH_SHORTEST_PATH_PRODUCT_BYTES = 2 * 1024 * 1024;

const encoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertEnvelope(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Solve Graph shortest-path product must be a JSON object.");
  }
  if (value.schema !== "solvelang.solve-graph.shortest-path-product.v0"
    || value.mode !== "analyze-only") {
    throw new Error("Solve Graph shortest-path product schema or mode is invalid.");
  }
  if (typeof value.graphId !== "string"
    || typeof value.sourceId !== "string"
    || typeof value.targetId !== "string"
    || (value.direction !== "dependencies" && value.direction !== "dependents")
    || typeof value.found !== "boolean"
    || (value.status !== "complete" && value.status !== "partial")) {
    throw new Error("Solve Graph shortest-path product identity fields are invalid.");
  }
  if (!isRecord(value.download) || !isRecord(value.download.artifact)) {
    throw new Error("Solve Graph shortest-path product download artifact is missing.");
  }
  if (!isRecord(value.presentation)) {
    throw new Error("Solve Graph shortest-path product presentation is missing.");
  }
  if (!isRecord(value.execution)
    || value.execution.networkAccess !== false
    || value.execution.writeAccess !== false
    || typeof value.execution.queryTruncated !== "boolean") {
    throw new Error("Solve Graph shortest-path product must remain capability-free.");
  }
}

function resultFromArtifact(artifact: Awaited<ReturnType<typeof verifySolveGraphShortestPathArtifact>>): SolveGraphShortestPathResult {
  return {
    direction: artifact.direction,
    sourceId: artifact.sourceId,
    targetId: artifact.targetId,
    found: artifact.found,
    nodeIds: [...artifact.nodeIds],
    hops: artifact.hops.map((hop) => ({ ...hop })),
    visitedCount: artifact.visitedCount,
    truncated: artifact.truncated,
    ...(artifact.truncationReason === undefined ? {} : { truncationReason: artifact.truncationReason }),
  };
}

export async function verifySolveGraphShortestPathProductBundle(
  sourceName: string,
  index: SolveGraphQueryIndex,
  value: unknown,
): Promise<SolveGraphShortestPathProductBundle> {
  assertEnvelope(value);
  if (value.graphId !== index.document.graphId) {
    throw new Error("Solve Graph shortest-path product belongs to a different graph.");
  }

  const download = value.download as Record<string, unknown>;
  const artifact = await verifySolveGraphShortestPathArtifact(index, download.artifact);
  const expected = await createSolveGraphShortestPathProductBundle(
    sourceName,
    index,
    resultFromArtifact(artifact),
  );

  if (canonicalSolveGraphJson(value) !== canonicalSolveGraphJson(expected)) {
    throw new Error("Solve Graph shortest-path product content verification failed.");
  }
  return expected;
}

export async function parseAndVerifySolveGraphShortestPathProductBundle(
  sourceName: string,
  index: SolveGraphQueryIndex,
  content: string,
): Promise<SolveGraphShortestPathProductBundle> {
  if (typeof content !== "string") {
    throw new Error("Solve Graph shortest-path product content must be text.");
  }
  if (encoder.encode(content).byteLength > MAX_SOLVE_GRAPH_SHORTEST_PATH_PRODUCT_BYTES) {
    throw new Error("Solve Graph shortest-path product exceeds the 2 MiB verification limit.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Solve Graph shortest-path product JSON is malformed.");
  }
  return verifySolveGraphShortestPathProductBundle(sourceName, index, parsed);
}
