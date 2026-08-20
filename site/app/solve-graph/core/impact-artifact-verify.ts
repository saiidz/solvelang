import { sha256Hex } from "../../repository-audit/core/ingestion";
import { canonicalSolveGraphJson } from "./canonical";
import type { SolveGraphImpactArtifact } from "./impact-artifact";

export async function verifySolveGraphImpactArtifact(value: unknown): Promise<SolveGraphImpactArtifact> {
  if (!value || typeof value !== "object") throw new Error("Solve Graph impact artifact must be an object.");
  const artifact = value as SolveGraphImpactArtifact;
  if (artifact.schema !== "solvelang.solve-graph.impact-artifact.v1" || artifact.schemaVersion !== "1.0.0" || artifact.mode !== "analyze-only" || artifact.execution?.networkAccess !== false || artifact.execution?.writeAccess !== false || artifact.query?.direction !== "dependents" || !Array.isArray(artifact.query.roots) || !Array.isArray(artifact.query.entries) || !artifact.integrity?.canonicalJsonSha256?.startsWith("sha256:")) throw new Error("Solve Graph impact artifact is invalid.");
  const { integrity, ...unsigned } = artifact;
  if (`sha256:${await sha256Hex(new TextEncoder().encode(canonicalSolveGraphJson(unsigned)))}` !== integrity.canonicalJsonSha256) throw new Error("Solve Graph impact artifact integrity verification failed.");
  return artifact;
}
