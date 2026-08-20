import type { RepositorySnapshot } from "./inventory";
import { normalizeRepositoryPath } from "./inventory";
import {
  analyzeDockerCompose,
  type DockerComposeEvidence,
} from "./dockerComposeEvidence";

const MAX_COMPOSE_TEXT_BYTES = 1024 * 1024;
const MAX_COMPOSE_FILES = 100;
const MAX_SKIPPED_EVIDENCE = 100;
const encoder = new TextEncoder();

type DockerComposeSkipReason = "missing-text" | "compose-too-large";

type DockerComposeSkippedFile = {
  path: string;
  reason: DockerComposeSkipReason;
};

export type DockerComposeSnapshotEvidence = {
  schema: "solvelang.repository-audit.docker-compose-snapshot.v0";
  mode: "analyze-only";
  source: {
    fingerprint: string;
    revision: string;
  };
  status: "absent" | "complete" | "partial";
  files: Array<{
    path: string;
    evidence: DockerComposeEvidence;
  }>;
  summary: {
    composeFilesSeen: number;
    composeTextsAccepted: number;
    composeFilesAnalyzed: number;
    composeFilesSkipped: number;
    composeFilesOmittedByFileBound: number;
    skippedEvidenceReturned: number;
    skippedEvidenceHidden: number;
  };
  skipped: DockerComposeSkippedFile[];
  notices: string[];
  execution: {
    containerBuild: false;
    imageResolution: false;
    networkAccess: false;
    writeAccess: false;
    maxComposeFiles: number;
    maxComposeTextBytes: number;
    maxSkippedEvidence: number;
  };
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function isComposeFile(path: string): boolean {
  return /^(?:docker-)?compose(?:\.[A-Za-z0-9_-]+)*\.ya?ml$/i.test(basename(path));
}

export function analyzeDockerComposeSnapshot(
  snapshot: RepositorySnapshot,
): DockerComposeSnapshotEvidence {
  const candidates = snapshot.files
    .map((file) => ({ ...file, path: normalizeRepositoryPath(file.path) }))
    .filter((file) => isComposeFile(file.path))
    .sort((left, right) => compareText(left.path, right.path));

  const selected = candidates.slice(0, MAX_COMPOSE_FILES);
  const composeFilesOmittedByFileBound = candidates.length - selected.length;
  const skippedAll: DockerComposeSkippedFile[] = [];
  const files: DockerComposeSnapshotEvidence["files"] = [];

  for (const file of selected) {
    if (file.text === undefined) {
      skippedAll.push({ path: file.path, reason: "missing-text" });
      continue;
    }
    if (
      file.byteSize > MAX_COMPOSE_TEXT_BYTES ||
      encoder.encode(file.text).byteLength > MAX_COMPOSE_TEXT_BYTES
    ) {
      skippedAll.push({ path: file.path, reason: "compose-too-large" });
      continue;
    }
    files.push({
      path: file.path,
      evidence: analyzeDockerCompose(file.text),
    });
  }

  const skipped = skippedAll.slice(0, MAX_SKIPPED_EVIDENCE);
  const skippedEvidenceHidden = skippedAll.length - skipped.length;
  const partial =
    skippedAll.length > 0 ||
    composeFilesOmittedByFileBound > 0 ||
    files.some((file) => file.evidence.truncated);
  const status = candidates.length === 0 ? "absent" : partial ? "partial" : "complete";

  return {
    schema: "solvelang.repository-audit.docker-compose-snapshot.v0",
    mode: "analyze-only",
    source: {
      fingerprint: snapshot.source.fingerprint,
      revision: snapshot.source.revision,
    },
    status,
    files,
    summary: {
      composeFilesSeen: candidates.length,
      composeTextsAccepted: files.length,
      composeFilesAnalyzed: files.length,
      composeFilesSkipped: skippedAll.length,
      composeFilesOmittedByFileBound,
      skippedEvidenceReturned: skipped.length,
      skippedEvidenceHidden,
    },
    skipped,
    notices: [
      candidates.length === 0
        ? "No conventional Docker Compose YAML files were present in the supplied repository snapshot."
        : "Docker Compose files are analyzed only from supplied bounded snapshot text; Compose evaluation, substitutions, anchors, image resolution, pulls, builds, and container starts are not performed.",
      ...(skippedAll.length > 0
        ? [
            `${skippedAll.length} Compose file(s) were omitted because text was unavailable or exceeded the 1 MiB text bound.`,
          ]
        : []),
      ...(composeFilesOmittedByFileBound > 0
        ? [
            `${composeFilesOmittedByFileBound} additional Compose file(s) were omitted by the deterministic ${MAX_COMPOSE_FILES}-file evidence bound.`,
          ]
        : []),
      ...(skippedEvidenceHidden > 0
        ? [
            `${skippedEvidenceHidden} additional skipped Compose records are hidden by the evidence bound.`,
          ]
        : []),
    ],
    execution: {
      containerBuild: false,
      imageResolution: false,
      networkAccess: false,
      writeAccess: false,
      maxComposeFiles: MAX_COMPOSE_FILES,
      maxComposeTextBytes: MAX_COMPOSE_TEXT_BYTES,
      maxSkippedEvidence: MAX_SKIPPED_EVIDENCE,
    },
  };
}
