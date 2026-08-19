import type { RepositoryDeploymentPathEvidenceAnalysis } from "./deploymentPathEvidence";
import { repositoryAuditSafeFilename } from "./report";
import { repositoryAuditIntegrityDigest } from "./reportIntegrity";

export type RepositoryDeploymentPathEvidenceArtifact = {
  schema: "solvelang.repository-audit.deployment-path-evidence.v1";
  schemaVersion: "1.0.0";
  mode: "analyze-only";
  graphId: string;
  status: RepositoryDeploymentPathEvidenceAnalysis["status"];
  relationships: RepositoryDeploymentPathEvidenceAnalysis["relationships"];
  skipped: RepositoryDeploymentPathEvidenceAnalysis["skipped"];
  execution: RepositoryDeploymentPathEvidenceAnalysis["execution"];
  integrity: {
    canonicalJsonSha256: string;
  };
};

export type RepositoryDeploymentPathEvidenceDownload = {
  filename: string;
  mediaType: "application/json;charset=utf-8";
  content: string;
  artifact: RepositoryDeploymentPathEvidenceArtifact;
};

function cloneDeploymentPathAnalysis(analysis: RepositoryDeploymentPathEvidenceAnalysis) {
  return {
    graphId: analysis.graphId,
    status: analysis.status,
    relationships: analysis.relationships.map((relationship) => ({
      evidenceId: relationship.evidenceId,
      kind: relationship.kind,
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

export async function createRepositoryDeploymentPathEvidenceArtifact(
  analysis: RepositoryDeploymentPathEvidenceAnalysis,
): Promise<RepositoryDeploymentPathEvidenceArtifact> {
  const cloned = cloneDeploymentPathAnalysis(analysis);
  const withoutIntegrity = {
    schema: "solvelang.repository-audit.deployment-path-evidence.v1" as const,
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

export function serializeRepositoryDeploymentPathEvidenceArtifact(
  artifact: RepositoryDeploymentPathEvidenceArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export async function createRepositoryDeploymentPathEvidenceDownload(
  archiveName: string,
  analysis: RepositoryDeploymentPathEvidenceAnalysis,
): Promise<RepositoryDeploymentPathEvidenceDownload> {
  const artifact = await createRepositoryDeploymentPathEvidenceArtifact(analysis);
  return {
    filename: `${repositoryAuditSafeFilename(archiveName)}-solvelang-repository-audit-deployment-paths.json`,
    mediaType: "application/json;charset=utf-8",
    content: serializeRepositoryDeploymentPathEvidenceArtifact(artifact),
    artifact,
  };
}
