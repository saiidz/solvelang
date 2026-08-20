import { sha256Hex } from "../../repository-audit/core/ingestion";
import { canonicalSolveGraphJson } from "./canonical";
import type { SolveGraphTraversalResult } from "./query-impact";

export type SolveGraphImpactArtifact = {
  schema: "solvelang.solve-graph.impact-artifact.v1";
  schemaVersion: "1.0.0";
  mode: "analyze-only";
  graphId: string;
  query: SolveGraphTraversalResult;
  execution: { networkAccess: false; writeAccess: false };
  integrity: { canonicalJsonSha256: string };
};

export type SolveGraphImpactDownload = { filename: string; mediaType: "application/json;charset=utf-8"; content: string; artifact: SolveGraphImpactArtifact };

function unsignedArtifact(graphId: string, query: SolveGraphTraversalResult) {
  return { schema: "solvelang.solve-graph.impact-artifact.v1" as const, schemaVersion: "1.0.0" as const, mode: "analyze-only" as const, graphId, query: { direction: query.direction, roots: [...query.roots], entries: query.entries.map((entry) => ({ ...entry })), truncated: query.truncated, ...(query.truncationReason ? { truncationReason: query.truncationReason } : {}) }, execution: { networkAccess: false as const, writeAccess: false as const } };
}

export async function createSolveGraphImpactDownload(sourceName: string, graphId: string, query: SolveGraphTraversalResult): Promise<SolveGraphImpactDownload> {
  if (query.direction !== "dependents" || query.roots.length === 0 || query.entries.length === 0 || query.entries.length > 10_000) throw new Error("Solve Graph impact artifact requires bounded dependent traversal evidence.");
  const unsigned = unsignedArtifact(graphId, query);
  const artifact: SolveGraphImpactArtifact = { ...unsigned, integrity: { canonicalJsonSha256: `sha256:${await sha256Hex(new TextEncoder().encode(canonicalSolveGraphJson(unsigned)))}` } };
  return { filename: `${sourceName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "solve-graph"}-impact.json`, mediaType: "application/json;charset=utf-8", content: `${canonicalSolveGraphJson(artifact)}\n`, artifact };
}
