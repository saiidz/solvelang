import type { RepositoryArchitecturePathAnalysis } from "./architecturePaths";
import { repositoryAuditSafeFilename } from "./report";
import { repositoryAuditIntegrityDigest } from "./reportIntegrity";

export type RepositoryArchitecturePathEvidenceArtifact = {
  schema: "solvelang.repository-audit.architecture-path-evidence.v1";
  schemaVersion: "1.0.0";
  mode: "analyze-only";
  graphId: string;
  status: RepositoryArchitecturePathAnalysis["status"];
  summary: RepositoryArchitecturePathAnalysis["summary"];
  paths: RepositoryArchitecturePathAnalysis["paths"];
  execution: RepositoryArchitecturePathAnalysis["execution"];
  integrity: {
    canonicalJsonSha256: string;
  };
};

export type RepositoryArchitecturePathEvidenceDownload = {
  filename: string;
  mediaType: "application/json;charset=utf-8";
  content: string;
  artifact: RepositoryArchitecturePathEvidenceArtifact;
};

function cloneArchitecturePathAnalysis(analysis: RepositoryArchitecturePathAnalysis) {
  return {
    graphId: analysis.graphId,
    status: analysis.status,
    summary: { ...analysis.summary },
    paths: analysis.paths.map((path) => ({
      classification: path.classification,
      root: { ...path.root },
      target: { ...path.target },
      depth: path.depth,
      segments: path.segments.map((segment) => ({
        edgeId: segment.edgeId,
        kind: segment.kind,
        from: segment.from,
        to: segment.to,
        ...(segment.evidence ? { evidence: { ...segment.evidence } } : {}),
      })),
    })),
    execution: {
      ...analysis.execution,
      networkAccess: false as const,
      writeAccess: false as const,
    },
  };
}

export async function createRepositoryArchitecturePathEvidenceArtifact(
  analysis: RepositoryArchitecturePathAnalysis,
): Promise<RepositoryArchitecturePathEvidenceArtifact> {
  const cloned = cloneArchitecturePathAnalysis(analysis);
  const withoutIntegrity = {
    schema: "solvelang.repository-audit.architecture-path-evidence.v1" as const,
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

export function serializeRepositoryArchitecturePathEvidenceArtifact(
  artifact: RepositoryArchitecturePathEvidenceArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export async function createRepositoryArchitecturePathEvidenceDownload(
  archiveName: string,
  analysis: RepositoryArchitecturePathAnalysis,
): Promise<RepositoryArchitecturePathEvidenceDownload> {
  const artifact = await createRepositoryArchitecturePathEvidenceArtifact(analysis);
  return {
    filename: `${repositoryAuditSafeFilename(archiveName)}-solvelang-repository-audit-architecture-paths.json`,
    mediaType: "application/json;charset=utf-8",
    content: serializeRepositoryArchitecturePathEvidenceArtifact(artifact),
    artifact,
  };
}
