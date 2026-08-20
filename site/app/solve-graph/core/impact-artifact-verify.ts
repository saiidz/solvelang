import { canonicalSolveGraphJson } from "./canonical";
import {
  createSolveGraphImpactArtifact,
  type SolveGraphImpactArtifact,
} from "./impact-artifact";
import type {
  SolveGraphQueryIndex,
  SolveGraphTraversalEntry,
  SolveGraphTraversalResult,
} from "./query-impact";

export const MAX_SOLVE_GRAPH_IMPACT_ARTIFACT_BYTES = 8 * 1024 * 1024;

const encoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertTraversalEntry(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.rootId !== "string"
    || !Number.isSafeInteger(value.depth)
    || (value.parentId !== undefined && typeof value.parentId !== "string")
    || (value.viaEdgeId !== undefined && typeof value.viaEdgeId !== "string")) {
    throw new Error("Solve Graph impact artifact traversal entry is invalid.");
  }
}

function assertEnvelope(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Solve Graph impact artifact must be a JSON object.");
  }
  if (value.schema !== "solvelang.solve-graph.impact-artifact.v1"
    || value.schemaVersion !== "1.0.0"
    || value.mode !== "analyze-only") {
    throw new Error("Solve Graph impact artifact schema or mode is invalid.");
  }
  if (typeof value.graphId !== "string") {
    throw new Error("Solve Graph impact artifact graph ID is invalid.");
  }
  if (!isRecord(value.query)
    || value.query.direction !== "dependents"
    || !Array.isArray(value.query.roots)
    || !value.query.roots.every((root) => typeof root === "string")
    || !Array.isArray(value.query.entries)
    || typeof value.query.truncated !== "boolean") {
    throw new Error("Solve Graph impact artifact query fields are invalid.");
  }
  value.query.entries.forEach(assertTraversalEntry);
  if (value.query.truncationReason !== undefined
    && value.query.truncationReason !== "depth"
    && value.query.truncationReason !== "result-count") {
    throw new Error("Solve Graph impact artifact truncation reason is invalid.");
  }
  if (!isRecord(value.execution)
    || value.execution.networkAccess !== false
    || value.execution.writeAccess !== false) {
    throw new Error("Solve Graph impact artifact must remain capability-free.");
  }
  if (!isRecord(value.integrity)
    || typeof value.integrity.canonicalJsonSha256 !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(value.integrity.canonicalJsonSha256)) {
    throw new Error("Solve Graph impact artifact integrity metadata is invalid.");
  }
}

function resultFromArtifact(value: Record<string, unknown>): SolveGraphTraversalResult {
  const query = value.query as Record<string, unknown>;
  return {
    direction: "dependents",
    roots: structuredClone(query.roots) as string[],
    entries: structuredClone(query.entries) as SolveGraphTraversalEntry[],
    truncated: query.truncated as boolean,
    ...(query.truncationReason === undefined
      ? {}
      : { truncationReason: query.truncationReason as SolveGraphTraversalResult["truncationReason"] }),
  };
}

export async function verifySolveGraphImpactArtifact(
  index: SolveGraphQueryIndex,
  value: unknown,
): Promise<SolveGraphImpactArtifact> {
  assertEnvelope(value);
  if (value.graphId !== index.document.graphId) {
    throw new Error("Solve Graph impact artifact belongs to a different graph.");
  }

  let rebuilt: SolveGraphImpactArtifact;
  try {
    rebuilt = await createSolveGraphImpactArtifact(index, resultFromArtifact(value));
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`Solve Graph impact artifact validation failed.${detail}`);
  }

  const suppliedIntegrity = (value.integrity as Record<string, unknown>).canonicalJsonSha256;
  if (suppliedIntegrity !== rebuilt.integrity.canonicalJsonSha256) {
    throw new Error("Solve Graph impact artifact integrity verification failed.");
  }
  if (canonicalSolveGraphJson(value) !== canonicalSolveGraphJson(rebuilt)) {
    throw new Error("Solve Graph impact artifact content is not canonical.");
  }
  return rebuilt;
}

export async function parseAndVerifySolveGraphImpactArtifact(
  index: SolveGraphQueryIndex,
  content: string,
): Promise<SolveGraphImpactArtifact> {
  if (typeof content !== "string") {
    throw new Error("Solve Graph impact artifact content must be text.");
  }
  if (encoder.encode(content).byteLength > MAX_SOLVE_GRAPH_IMPACT_ARTIFACT_BYTES) {
    throw new Error("Solve Graph impact artifact exceeds the 8 MiB verification limit.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Solve Graph impact artifact JSON is malformed.");
  }
  return verifySolveGraphImpactArtifact(index, parsed);
}
