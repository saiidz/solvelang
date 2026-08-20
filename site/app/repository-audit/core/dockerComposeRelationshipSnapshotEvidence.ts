import type { RepositorySnapshot } from "./inventory";
import { normalizeRepositoryPath } from "./inventory";
import {
  analyzeDockerComposeServiceRelationships,
  type DockerComposeServiceRelationshipEvidence,
} from "./dockerComposeServiceRelationships";

const MAX_COMPOSE_TEXT_BYTES = 1024 * 1024;
const MAX_COMPOSE_FILES = 100;
const MAX_SKIPPED_EVIDENCE = 100;
const DEFAULT_MAX_RELATIONSHIPS_PER_FILE = 1_000;
const MAX_RELATIONSHIPS_PER_FILE = 2_000;
const encoder = new TextEncoder();

type DockerComposeRelationshipSkipReason = "missing-text" | "compose-too-large";

type DockerComposeRelationshipSkippedFile = {
  path: string;
  reason: DockerComposeRelationshipSkipReason;
};

export type DockerComposeRelationshipSnapshotEvidence = {
  schema: "solvelang.repository-audit.docker-compose-relationship-snapshot.v0";
  mode: "analyze-only";
  source: {
    fingerprint: string;
    revision: string;
  };
  status: "absent" | "complete" | "partial";
  files: Array<{
    path: string;
    evidence: DockerComposeServiceRelationshipEvidence;
  }>;
  summary: {
    composeFilesSeen: number;
    composeTextsAccepted: number;
    composeFilesAnalyzed: number;
    composeFilesSkipped: number;
    composeFilesOmittedByFileBound: number;
    servicesSeen: number;
    relationshipsSeen: number;
    relationshipsReturned: number;
    relationshipsHidden: number;
    missingTargets: number;
    unsupportedReferences: number;
    duplicateRelationships: number;
    skippedEvidenceReturned: number;
    skippedEvidenceHidden: number;
  };
  skipped: DockerComposeRelationshipSkippedFile[];
  notices: string[];
  execution: {
    composeEvaluation: false;
    containerStart: false;
    networkAccess: false;
    writeAccess: false;
    maxComposeFiles: number;
    maxComposeTextBytes: number;
    maxSkippedEvidence: number;
    maxRelationshipsPerFile: number;
  };
};

export type DockerComposeRelationshipSnapshotOptions = {
  maxRelationshipsPerFile?: number;
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

function boundedRelationshipsPerFile(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_RELATIONSHIPS_PER_FILE;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_RELATIONSHIPS_PER_FILE) {
    throw new Error(`Docker Compose maxRelationshipsPerFile must be an integer from 1 through ${MAX_RELATIONSHIPS_PER_FILE}.`);
  }
  return resolved;
}

export function analyzeDockerComposeRelationshipSnapshot(
  snapshot: RepositorySnapshot,
  options: DockerComposeRelationshipSnapshotOptions = {},
): DockerComposeRelationshipSnapshotEvidence {
  const maxRelationshipsPerFile = boundedRelationshipsPerFile(options.maxRelationshipsPerFile);
  const candidates = snapshot.files
    .map((file) => ({ ...file, path: normalizeRepositoryPath(file.path) }))
    .filter((file) => isComposeFile(file.path))
    .sort((left, right) => compareText(left.path, right.path));

  const selected = candidates.slice(0, MAX_COMPOSE_FILES);
  const composeFilesOmittedByFileBound = candidates.length - selected.length;
  const skippedAll: DockerComposeRelationshipSkippedFile[] = [];
  const files: DockerComposeRelationshipSnapshotEvidence["files"] = [];

  for (const file of selected) {
    if (file.text === undefined) {
      skippedAll.push({ path: file.path, reason: "missing-text" });
      continue;
    }
    if (
      file.byteSize > MAX_COMPOSE_TEXT_BYTES
      || encoder.encode(file.text).byteLength > MAX_COMPOSE_TEXT_BYTES
    ) {
      skippedAll.push({ path: file.path, reason: "compose-too-large" });
      continue;
    }
    files.push({
      path: file.path,
      evidence: analyzeDockerComposeServiceRelationships(file.text, { maxRelationships: maxRelationshipsPerFile }),
    });
  }

  const skipped = skippedAll.slice(0, MAX_SKIPPED_EVIDENCE);
  const skippedEvidenceHidden = skippedAll.length - skipped.length;
  const aggregate = files.reduce(
    (summary, file) => ({
      servicesSeen: summary.servicesSeen + file.evidence.summary.servicesSeen,
      relationshipsSeen: summary.relationshipsSeen + file.evidence.summary.relationshipsSeen,
      relationshipsReturned: summary.relationshipsReturned + file.evidence.summary.relationshipsReturned,
      relationshipsHidden: summary.relationshipsHidden + file.evidence.summary.relationshipsHidden,
      missingTargets: summary.missingTargets + file.evidence.summary.missingTargets,
      unsupportedReferences: summary.unsupportedReferences + file.evidence.summary.unsupportedReferences,
      duplicateRelationships: summary.duplicateRelationships + file.evidence.summary.duplicateRelationships,
    }),
    {
      servicesSeen: 0,
      relationshipsSeen: 0,
      relationshipsReturned: 0,
      relationshipsHidden: 0,
      missingTargets: 0,
      unsupportedReferences: 0,
      duplicateRelationships: 0,
    },
  );
  const partial =
    skippedAll.length > 0
    || composeFilesOmittedByFileBound > 0
    || files.some((file) => file.evidence.status === "partial");
  const status = candidates.length === 0 ? "absent" : partial ? "partial" : "complete";

  return {
    schema: "solvelang.repository-audit.docker-compose-relationship-snapshot.v0",
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
      ...aggregate,
      skippedEvidenceReturned: skipped.length,
      skippedEvidenceHidden,
    },
    skipped,
    notices: [
      candidates.length === 0
        ? "No conventional Docker Compose YAML files were present in the supplied repository snapshot."
        : "Explicit Docker Compose depends_on relationships are analyzed only from supplied bounded snapshot text; Compose evaluation, interpolation, anchors, profiles, container starts, network access, and writes are not performed.",
      ...(skippedAll.length > 0
        ? [`${skippedAll.length} Compose file(s) were omitted because text was unavailable or exceeded the 1 MiB text bound.`]
        : []),
      ...(composeFilesOmittedByFileBound > 0
        ? [`${composeFilesOmittedByFileBound} additional Compose file(s) were omitted by the deterministic ${MAX_COMPOSE_FILES}-file evidence bound.`]
        : []),
      ...(aggregate.unsupportedReferences > 0
        ? [`${aggregate.unsupportedReferences} dynamic or unsupported depends_on reference(s) were skipped instead of guessed.`]
        : []),
      ...(aggregate.relationshipsHidden > 0
        ? [`${aggregate.relationshipsHidden} additional depends_on relationship(s) were hidden by per-file relationship bounds.`]
        : []),
      ...(skippedEvidenceHidden > 0
        ? [`${skippedEvidenceHidden} additional skipped Compose records are hidden by the evidence bound.`]
        : []),
    ],
    execution: {
      composeEvaluation: false,
      containerStart: false,
      networkAccess: false,
      writeAccess: false,
      maxComposeFiles: MAX_COMPOSE_FILES,
      maxComposeTextBytes: MAX_COMPOSE_TEXT_BYTES,
      maxSkippedEvidence: MAX_SKIPPED_EVIDENCE,
      maxRelationshipsPerFile,
    },
  };
}
