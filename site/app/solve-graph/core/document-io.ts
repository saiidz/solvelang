import { canonicalSolveGraphJson, createSolveGraphDocument } from "./canonical";
import { SOLVE_GRAPH_SCHEMA, type SolveGraphDocument } from "./contracts";
import { createSolveGraphQueryIndex, type SolveGraphQueryIndex } from "./query-impact";

export const MAX_LOCAL_SOLVE_GRAPH_BYTES = 8 * 1024 * 1024;

export type LoadedSolveGraphDocument = {
  document: SolveGraphDocument;
  index: SolveGraphQueryIndex;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Solve Graph ${label} must be an object.`);
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Solve Graph ${label} must be an array.`);
  return value;
}

export async function loadSolveGraphDocumentText(text: string): Promise<LoadedSolveGraphDocument> {
  if (typeof text !== "string" || text.length === 0) throw new Error("Solve Graph JSON is empty.");
  if (new TextEncoder().encode(text).byteLength > MAX_LOCAL_SOLVE_GRAPH_BYTES) {
    throw new Error("Solve Graph JSON exceeds the 8 MB local explorer limit.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Solve Graph JSON is malformed.");
  }

  const raw = requireRecord(parsed, "document");
  if (raw.schema !== SOLVE_GRAPH_SCHEMA) throw new Error(`Unsupported Solve Graph schema: ${String(raw.schema)}`);
  if (raw.mode !== "analyze-only") throw new Error("Solve Graph explorer accepts analyze-only documents only.");

  const engine = requireRecord(raw.engine, "engine");
  if (typeof engine.version !== "string" || engine.version.length === 0) throw new Error("Solve Graph engine version is invalid.");
  const execution = requireRecord(raw.execution, "execution");
  if (execution.networkAccess !== false || execution.writeAccess !== false) {
    throw new Error("Solve Graph explorer requires networkAccess=false and writeAccess=false.");
  }
  if (execution.status !== "complete" && execution.status !== "partial") throw new Error("Solve Graph execution status is invalid.");
  const truncationReasons = requireArray(execution.truncationReasons, "truncation reasons");
  const source = requireRecord(raw.source, "source");
  const limits = requireRecord(raw.limits, "limits");
  const extractors = requireArray(raw.extractors, "extractors");
  const nodes = requireArray(raw.nodes, "nodes");
  const edges = requireArray(raw.edges, "edges");
  requireRecord(raw.integrity, "integrity");

  const candidate = raw as unknown as SolveGraphDocument;
  const rebuilt = await createSolveGraphDocument({
    source: candidate.source,
    engineVersion: engine.version,
    extractors: candidate.extractors,
    limits: candidate.limits,
    status: execution.status,
    truncationReasons: truncationReasons as SolveGraphDocument["execution"]["truncationReasons"],
    nodes: candidate.nodes,
    edges: candidate.edges,
  });

  if (canonicalSolveGraphJson(candidate) !== canonicalSolveGraphJson(rebuilt)) {
    throw new Error("Solve Graph document does not match its canonical representation.");
  }

  return { document: rebuilt, index: await createSolveGraphQueryIndex(rebuilt) };
}
