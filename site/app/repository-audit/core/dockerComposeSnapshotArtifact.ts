import type { DockerComposeSnapshotEvidence } from "./dockerComposeSnapshotEvidence";
import { repositoryAuditSafeFilename } from "./report";
import { repositoryAuditIntegrityDigest } from "./reportIntegrity";

export type DockerComposeSnapshotArtifact = {
  schema: "solvelang.repository-audit.docker-compose-snapshot.v1";
  schemaVersion: "1.0.0";
  mode: "analyze-only";
  source: DockerComposeSnapshotEvidence["source"];
  status: DockerComposeSnapshotEvidence["status"];
  files: DockerComposeSnapshotEvidence["files"];
  summary: DockerComposeSnapshotEvidence["summary"];
  skipped: DockerComposeSnapshotEvidence["skipped"];
  notices: string[];
  execution: DockerComposeSnapshotEvidence["execution"];
  integrity: {
    canonicalJsonSha256: string;
  };
};

export type DockerComposeSnapshotDownload = {
  filename: string;
  mediaType: "application/json;charset=utf-8";
  content: string;
  artifact: DockerComposeSnapshotArtifact;
};

function cloneDockerComposeSnapshot(
  evidence: DockerComposeSnapshotEvidence,
) {
  return {
    source: { ...evidence.source },
    status: evidence.status,
    files: evidence.files.map((file) => ({
      path: file.path,
      evidence: {
        services: file.evidence.services.map((service) => ({ ...service })),
        truncated: file.evidence.truncated,
        notices: [...file.evidence.notices],
        execution: { ...file.evidence.execution },
      },
    })),
    summary: { ...evidence.summary },
    skipped: evidence.skipped.map((record) => ({ ...record })),
    notices: [...evidence.notices],
    execution: {
      ...evidence.execution,
      containerBuild: false as const,
      imageResolution: false as const,
      networkAccess: false as const,
      writeAccess: false as const,
    },
  };
}

export async function createDockerComposeSnapshotArtifact(
  evidence: DockerComposeSnapshotEvidence,
): Promise<DockerComposeSnapshotArtifact> {
  const cloned = cloneDockerComposeSnapshot(evidence);
  const withoutIntegrity = {
    schema: "solvelang.repository-audit.docker-compose-snapshot.v1" as const,
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

export function serializeDockerComposeSnapshotArtifact(
  artifact: DockerComposeSnapshotArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export async function createDockerComposeSnapshotDownload(
  archiveName: string,
  evidence: DockerComposeSnapshotEvidence,
): Promise<DockerComposeSnapshotDownload> {
  const artifact = await createDockerComposeSnapshotArtifact(evidence);
  return {
    filename: `${repositoryAuditSafeFilename(archiveName)}-solvelang-repository-audit-docker-compose.json`,
    mediaType: "application/json;charset=utf-8",
    content: serializeDockerComposeSnapshotArtifact(artifact),
    artifact,
  };
}
