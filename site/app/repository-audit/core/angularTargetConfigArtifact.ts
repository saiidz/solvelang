import type { RepositoryAngularTargetConfigEvidenceAnalysis } from "./angularTargetConfigEvidence";
import { repositoryAuditSafeFilename } from "./report";
import { repositoryAuditIntegrityDigest } from "./reportIntegrity";

export type RepositoryAngularTargetConfigEvidenceArtifact = {
  schema: "solvelang.repository-audit.angular-target-config-evidence.v1";
  schemaVersion: "1.0.0";
  mode: "analyze-only";
  graphId: string;
  status: RepositoryAngularTargetConfigEvidenceAnalysis["status"];
  relationships: RepositoryAngularTargetConfigEvidenceAnalysis["relationships"];
  skipped: RepositoryAngularTargetConfigEvidenceAnalysis["skipped"];
  execution: RepositoryAngularTargetConfigEvidenceAnalysis["execution"];
  integrity: {
    canonicalJsonSha256: string;
  };
};

export type RepositoryAngularTargetConfigEvidenceDownload = {
  filename: string;
  mediaType: "application/json;charset=utf-8";
  content: string;
  artifact: RepositoryAngularTargetConfigEvidenceArtifact;
};

function cloneAngularTargetConfigAnalysis(analysis: RepositoryAngularTargetConfigEvidenceAnalysis) {
  return {
    graphId: analysis.graphId,
    status: analysis.status,
    relationships: analysis.relationships.map((relationship) => ({
      evidenceId: relationship.evidenceId,
      kind: relationship.kind,
      framework: relationship.framework,
      fromPath: relationship.fromPath,
      project: relationship.project,
      target: relationship.target,
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

export async function createRepositoryAngularTargetConfigEvidenceArtifact(
  analysis: RepositoryAngularTargetConfigEvidenceAnalysis,
): Promise<RepositoryAngularTargetConfigEvidenceArtifact> {
  const cloned = cloneAngularTargetConfigAnalysis(analysis);
  const withoutIntegrity = {
    schema: "solvelang.repository-audit.angular-target-config-evidence.v1" as const,
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

export function serializeRepositoryAngularTargetConfigEvidenceArtifact(
  artifact: RepositoryAngularTargetConfigEvidenceArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export async function createRepositoryAngularTargetConfigEvidenceDownload(
  archiveName: string,
  analysis: RepositoryAngularTargetConfigEvidenceAnalysis,
): Promise<RepositoryAngularTargetConfigEvidenceDownload> {
  const artifact = await createRepositoryAngularTargetConfigEvidenceArtifact(analysis);
  return {
    filename: `${repositoryAuditSafeFilename(archiveName)}-solvelang-repository-audit-angular-target-config.json`,
    mediaType: "application/json;charset=utf-8",
    content: serializeRepositoryAngularTargetConfigEvidenceArtifact(artifact),
    artifact,
  };
}
