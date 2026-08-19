import type { RepositoryFrameworkPathEvidenceAnalysis } from "./frameworkPathEvidence";
import { repositoryAuditSafeFilename } from "./report";
import { repositoryAuditIntegrityDigest } from "./reportIntegrity";

export type RepositoryFrameworkPathEvidenceArtifact = {
  schema: "solvelang.repository-audit.framework-path-evidence.v1";
  schemaVersion: "1.0.0";
  mode: "analyze-only";
  graphId: string;
  status: RepositoryFrameworkPathEvidenceAnalysis["status"];
  relationships: RepositoryFrameworkPathEvidenceAnalysis["relationships"];
  skipped: RepositoryFrameworkPathEvidenceAnalysis["skipped"];
  execution: RepositoryFrameworkPathEvidenceAnalysis["execution"];
  integrity: {
    canonicalJsonSha256: string;
  };
};

export type RepositoryFrameworkPathEvidenceDownload = {
  filename: string;
  mediaType: "application/json;charset=utf-8";
  content: string;
  artifact: RepositoryFrameworkPathEvidenceArtifact;
};

function cloneFrameworkPathAnalysis(analysis: RepositoryFrameworkPathEvidenceAnalysis) {
  return {
    graphId: analysis.graphId,
    status: analysis.status,
    relationships: analysis.relationships.map((relationship) => ({
      evidenceId: relationship.evidenceId,
      kind: relationship.kind,
      framework: relationship.framework,
      fromPath: relationship.fromPath,
      rawReference: relationship.rawReference,
      targetPath: relationship.targetPath,
      targetType: relationship.targetType,
      targetState: relationship.targetState,
      evidence: { ...relationship.evidence },
    })),
    skipped: { ...analysis.skipped },
    execution: {
      ...analysis.execution,
      networkAccess: false as const,
      writeAccess: false as const,
    },
  };
}

export async function createRepositoryFrameworkPathEvidenceArtifact(
  analysis: RepositoryFrameworkPathEvidenceAnalysis,
): Promise<RepositoryFrameworkPathEvidenceArtifact> {
  const cloned = cloneFrameworkPathAnalysis(analysis);
  const withoutIntegrity = {
    schema: "solvelang.repository-audit.framework-path-evidence.v1" as const,
    schemaVersion: "1.0.0" as const,
    mode: "analyze-only" as const,
    ...cloned,
  };
  const canonicalJsonSha256 = await repositoryAuditIntegrityDigest(withoutIntegrity);
  return {
    ...withoutIntegrity,
    integrity: { canonicalJsonSha256 },
  };
}

export function serializeRepositoryFrameworkPathEvidenceArtifact(
  artifact: RepositoryFrameworkPathEvidenceArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export async function createRepositoryFrameworkPathEvidenceDownload(
  archiveName: string,
  analysis: RepositoryFrameworkPathEvidenceAnalysis,
): Promise<RepositoryFrameworkPathEvidenceDownload> {
  const artifact = await createRepositoryFrameworkPathEvidenceArtifact(analysis);
  return {
    filename: `${repositoryAuditSafeFilename(archiveName)}-solvelang-repository-audit-framework-paths.json`,
    mediaType: "application/json;charset=utf-8",
    content: serializeRepositoryFrameworkPathEvidenceArtifact(artifact),
    artifact,
  };
}
