import type { SolveGraphAlternativePathsResult } from "./alternative-paths";
import {
  createSolveGraphAlternativePathsArtifact,
  type SolveGraphAlternativePathsArtifact,
} from "./alternative-paths-artifact";
import { canonicalSolveGraphJson } from "./canonical";
import type { SolveGraphQueryIndex } from "./query-impact";

export const MAX_SOLVE_GRAPH_ALTERNATIVE_PATH_ARTIFACT_BYTES = 1024 * 1024;

const encoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertEnvelope(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Solve Graph alternative-path artifact must be a JSON object.");
  }
  if (value.schema !== "solvelang.solve-graph.alternative-paths-artifact.v1"
    || value.schemaVersion !== "1.0.0"
    || value.mode !== "analyze-only") {
    throw new Error("Solve Graph alternative-path artifact schema or mode is invalid.");
  }
  if (typeof value.graphId !== "string"
    || typeof value.sourceId !== "string"
    || typeof value.targetId !== "string"
    || (value.direction !== "dependencies" && value.direction !== "dependents")
    || !Array.isArray(value.paths)
    || !Number.isSafeInteger(value.statesCreated)
    || typeof value.truncated !== "boolean") {
    throw new Error("Solve Graph alternative-path artifact query fields are invalid.");
  }
  if (value.truncationReason !== undefined
    && value.truncationReason !== "depth"
    && value.truncationReason !== "path-count"
    && value.truncationReason !== "state-count") {
    throw new Error("Solve Graph alternative-path artifact truncation reason is invalid.");
  }
  if (!isRecord(value.execution)
    || value.execution.networkAccess !== false
    || value.execution.writeAccess !== false) {
    throw new Error("Solve Graph alternative-path artifact must remain capability-free.");
  }
  if (!isRecord(value.integrity)
    || typeof value.integrity.canonicalJsonSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(value.integrity.canonicalJsonSha256)) {
    throw new Error("Solve Graph alternative-path artifact integrity metadata is invalid.");
  }
}

function resultFromArtifact(value: Record<string, unknown>): SolveGraphAlternativePathsResult {
  return {
    direction: value.direction as SolveGraphAlternativePathsResult["direction"],
    sourceId: value.sourceId as string,
    targetId: value.targetId as string,
    paths: structuredClone(value.paths) as SolveGraphAlternativePathsResult["paths"],
    statesCreated: value.statesCreated as number,
    truncated: value.truncated as boolean,
    ...(value.truncationReason === undefined
      ? {}
      : { truncationReason: value.truncationReason as SolveGraphAlternativePathsResult["truncationReason"] }),
  };
}

export async function verifySolveGraphAlternativePathsArtifact(
  index: SolveGraphQueryIndex,
  value: unknown,
): Promise<SolveGraphAlternativePathsArtifact> {
  assertEnvelope(value);
  if (value.graphId !== index.document.graphId) {
    throw new Error("Solve Graph alternative-path artifact belongs to a different graph.");
  }

  let rebuilt: SolveGraphAlternativePathsArtifact;
  try {
    rebuilt = await createSolveGraphAlternativePathsArtifact(index, resultFromArtifact(value));
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`Solve Graph alternative-path artifact validation failed.${detail}`);
  }

  const suppliedIntegrity = (value.integrity as Record<string, unknown>).canonicalJsonSha256;
  if (suppliedIntegrity !== rebuilt.integrity.canonicalJsonSha256) {
    throw new Error("Solve Graph alternative-path artifact integrity verification failed.");
  }
  if (canonicalSolveGraphJson(value) !== canonicalSolveGraphJson(rebuilt)) {
    throw new Error("Solve Graph alternative-path artifact content is not canonical.");
  }

  return rebuilt;
}

export async function parseAndVerifySolveGraphAlternativePathsArtifact(
  index: SolveGraphQueryIndex,
  content: string,
): Promise<SolveGraphAlternativePathsArtifact> {
  if (typeof content !== "string") {
    throw new Error("Solve Graph alternative-path artifact content must be text.");
  }
  if (encoder.encode(content).byteLength > MAX_SOLVE_GRAPH_ALTERNATIVE_PATH_ARTIFACT_BYTES) {
    throw new Error("Solve Graph alternative-path artifact exceeds the 1 MiB verification limit.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Solve Graph alternative-path artifact JSON is malformed.");
  }
  return verifySolveGraphAlternativePathsArtifact(index, parsed);
}
