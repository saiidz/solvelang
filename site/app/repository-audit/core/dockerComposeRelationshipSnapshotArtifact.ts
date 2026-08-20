import type { DockerComposeRelationshipSnapshotEvidence } from "./dockerComposeRelationshipSnapshotEvidence";
import { repositoryAuditSafeFilename } from "./report";
import { repositoryAuditIntegrityDigest } from "./reportIntegrity";

export type DockerComposeRelationshipSnapshotArtifact = {
  schema: "solvelang.repository-audit.docker-compose-relationship-snapshot.v1";
  schemaVersion: "1.0.0";
  mode: "analyze-only";
  source: DockerComposeRelationshipSnapshotEvidence["source"];
  status: DockerComposeRelationshipSnapshotEvidence["status"];
  files: DockerComposeRelationshipSnapshotEvidence["files"];
  summary: DockerComposeRelationshipSnapshotEvidence["summary"];
  skipped: DockerComposeRelationshipSnapshotEvidence["skipped"];
  notices: string[];
  execution: DockerComposeRelationshipSnapshotEvidence["execution"];
  integrity: {
    canonicalJsonSha256: string;
  };
};

export type DockerComposeRelationshipSnapshotDownload = {
  filename: string;
  mediaType: "application/json;charset=utf-8";
  content: string;
  artifact: DockerComposeRelationshipSnapshotArtifact;
};

function cloneDockerComposeRelationshipSnapshot(
  evidence: DockerComposeRelationshipSnapshotEvidence,
) {
  return {
    source: { ...evidence.source },
    status: evidence.status,
    files: evidence.files.map((file) => ({
      path: file.path,
      evidence: {
        schema: file.evidence.schema,
        mode: file.evidence.mode,
        status: file.evidence.status,
        services: [...file.evidence.services],
        relationships: file.evidence.relationships.map((relationship) => ({
          ...relationship,
          evidence: { ...relationship.evidence },
        })),
        summary: { ...file.evidence.summary },
        notices: [...file.evidence.notices],
        execution: { ...file.evidence.execution },
      },
    })),
    summary: { ...evidence.summary },
    skipped: evidence.skipped.map((record) => ({ ...record })),
    notices: [...evidence.notices],
    execution: {
      ...evidence.execution,
      composeEvaluation: false as const,
      containerStart: false as const,
      networkAccess: false as const,
      writeAccess: false as const,
    },
  };
}

export async function createDockerComposeRelationshipSnapshotArtifact(
  evidence: DockerComposeRelationshipSnapshotEvidence,
): Promise<DockerComposeRelationshipSnapshotArtifact> {
  const cloned = cloneDockerComposeRelationshipSnapshot(evidence);
  const withoutIntegrity = {
    schema: "solvelang.repository-audit.docker-compose-relationship-snapshot.v1" as const,
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

export function serializeDockerComposeRelationshipSnapshotArtifact(
  artifact: DockerComposeRelationshipSnapshotArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export async function createDockerComposeRelationshipSnapshotDownload(
  archiveName: string,
  evidence: DockerComposeRelationshipSnapshotEvidence,
): Promise<DockerComposeRelationshipSnapshotDownload> {
  const artifact = await createDockerComposeRelationshipSnapshotArtifact(evidence);
  return {
    filename: `${repositoryAuditSafeFilename(archiveName)}-solvelang-repository-audit-docker-compose-relationships.json`,
    mediaType: "application/json;charset=utf-8",
    content: serializeDockerComposeRelationshipSnapshotArtifact(artifact),
    artifact,
  };
}
