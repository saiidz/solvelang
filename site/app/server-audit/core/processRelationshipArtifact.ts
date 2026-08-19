import type {
  ServerAuditProcessRelationship,
  ServerAuditProcessRelationshipAnalysis,
} from "./processRelationships";

export type ServerAuditProcessRelationshipArtifact = {
  schema: "solvelang.server-audit.process-relationships-artifact.v1";
  schemaVersion: "1.0.0";
  mode: "analyze-only";
  status: "complete" | "partial";
  relationships: Array<{
    id: string;
    kind: ServerAuditProcessRelationship["kind"];
    sources: string[];
    sourcesTruncated?: true;
  }>;
  summary: { ...ServerAuditProcessRelationshipAnalysis["summary"] };
  execution: {
    maxRelationships: number;
    maxSourcesPerRelationship: number;
    maxAttributionLabelBytes: number;
    relationshipsTruncated: boolean;
    networkAccess: false;
    writeAccess: false;
  };
  integrity: {
    canonicalJsonSha256: string;
  };
};

export type ServerAuditProcessRelationshipDownload = {
  filename: string;
  mediaType: "application/json;charset=utf-8";
  content: string;
  artifact: ServerAuditProcessRelationshipArtifact;
};

const encoder = new TextEncoder();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourcePartial(analysis: ServerAuditProcessRelationshipAnalysis): boolean {
  return analysis.execution.relationshipsTruncated
    || analysis.summary.relationshipsWithTruncatedSources > 0
    || analysis.summary.ambiguousListenerAttributions > 0
    || analysis.summary.unresolvedListenerAttributions > 0
    || analysis.summary.duplicateProcessIdsSkipped > 0
    || analysis.summary.invalidProcessLabelsSkipped > 0
    || analysis.summary.invalidListenerLabelsSkipped > 0;
}

function cloneRelationships(analysis: ServerAuditProcessRelationshipAnalysis) {
  return [...analysis.relationships]
    .sort((left, right) => compareText(left.id, right.id))
    .map((relationship) => ({
      id: relationship.id,
      kind: relationship.kind,
      sources: [...relationship.sources],
      ...(relationship.sourcesTruncated === true ? { sourcesTruncated: true as const } : {}),
    }));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeFilename(value: string): string {
  const normalized = value
    .normalize("NFC")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const stem = normalized.replace(/\.[A-Za-z0-9]{1,8}$/, "").slice(0, 96);
  return stem || "server-audit";
}

function assertSafeAnalysis(analysis: ServerAuditProcessRelationshipAnalysis): void {
  if (analysis.mode !== "analyze-only"
    || analysis.execution.networkAccess !== false
    || analysis.execution.writeAccess !== false) {
    throw new Error("Server Audit process relationship artifact requires analyze-only input with networkAccess=false and writeAccess=false.");
  }
}

export async function createServerAuditProcessRelationshipArtifact(
  analysis: ServerAuditProcessRelationshipAnalysis,
): Promise<ServerAuditProcessRelationshipArtifact> {
  assertSafeAnalysis(analysis);
  const withoutIntegrity = {
    schema: "solvelang.server-audit.process-relationships-artifact.v1" as const,
    schemaVersion: "1.0.0" as const,
    mode: "analyze-only" as const,
    status: sourcePartial(analysis) ? "partial" as const : "complete" as const,
    relationships: cloneRelationships(analysis),
    summary: { ...analysis.summary },
    execution: {
      maxRelationships: analysis.execution.maxRelationships,
      maxSourcesPerRelationship: analysis.execution.maxSourcesPerRelationship,
      maxAttributionLabelBytes: analysis.execution.maxAttributionLabelBytes,
      relationshipsTruncated: analysis.execution.relationshipsTruncated,
      networkAccess: false as const,
      writeAccess: false as const,
    },
  };
  const canonicalJsonSha256 = await sha256Hex(JSON.stringify(withoutIntegrity));
  return {
    ...withoutIntegrity,
    integrity: { canonicalJsonSha256 },
  };
}

export function serializeServerAuditProcessRelationshipArtifact(
  artifact: ServerAuditProcessRelationshipArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export async function createServerAuditProcessRelationshipDownload(
  sourceName: string,
  analysis: ServerAuditProcessRelationshipAnalysis,
): Promise<ServerAuditProcessRelationshipDownload> {
  const artifact = await createServerAuditProcessRelationshipArtifact(analysis);
  return {
    filename: `${safeFilename(sourceName)}-solvelang-server-audit-process-relationships.json`,
    mediaType: "application/json;charset=utf-8",
    content: serializeServerAuditProcessRelationshipArtifact(artifact),
    artifact,
  };
}
