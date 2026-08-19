import type { RepositoryPackageScriptPathEvidenceAnalysis } from "./packageScriptPathEvidence";
import { repositoryAuditSafeFilename } from "./report";
import { repositoryAuditIntegrityDigest } from "./reportIntegrity";

export type RepositoryPackageScriptPathEvidenceArtifact = {
  schema: "solvelang.repository-audit.package-script-path-evidence.v1";
  schemaVersion: "1.0.0";
  mode: "analyze-only";
  graphId: string;
  status: RepositoryPackageScriptPathEvidenceAnalysis["status"];
  relationships: RepositoryPackageScriptPathEvidenceAnalysis["relationships"];
  skipped: RepositoryPackageScriptPathEvidenceAnalysis["skipped"];
  execution: RepositoryPackageScriptPathEvidenceAnalysis["execution"];
  integrity: {
    canonicalJsonSha256: string;
  };
};

export type RepositoryPackageScriptPathEvidenceDownload = {
  filename: string;
  mediaType: "application/json;charset=utf-8";
  content: string;
  artifact: RepositoryPackageScriptPathEvidenceArtifact;
};

function clonePackageScriptPathAnalysis(analysis: RepositoryPackageScriptPathEvidenceAnalysis) {
  return {
    graphId: analysis.graphId,
    status: analysis.status,
    relationships: analysis.relationships.map((relationship) => ({
      evidenceId: relationship.evidenceId,
      kind: relationship.kind,
      fromPath: relationship.fromPath,
      scriptName: relationship.scriptName,
      rawReference: relationship.rawReference,
      targetPath: relationship.targetPath,
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

export async function createRepositoryPackageScriptPathEvidenceArtifact(
  analysis: RepositoryPackageScriptPathEvidenceAnalysis,
): Promise<RepositoryPackageScriptPathEvidenceArtifact> {
  const cloned = clonePackageScriptPathAnalysis(analysis);
  const withoutIntegrity = {
    schema: "solvelang.repository-audit.package-script-path-evidence.v1" as const,
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

export function serializeRepositoryPackageScriptPathEvidenceArtifact(
  artifact: RepositoryPackageScriptPathEvidenceArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export async function createRepositoryPackageScriptPathEvidenceDownload(
  archiveName: string,
  analysis: RepositoryPackageScriptPathEvidenceAnalysis,
): Promise<RepositoryPackageScriptPathEvidenceDownload> {
  const artifact = await createRepositoryPackageScriptPathEvidenceArtifact(analysis);
  return {
    filename: `${repositoryAuditSafeFilename(archiveName)}-solvelang-repository-audit-package-script-paths.json`,
    mediaType: "application/json;charset=utf-8",
    content: serializeRepositoryPackageScriptPathEvidenceArtifact(artifact),
    artifact,
  };
}
