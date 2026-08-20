import type { DockerComposeRelationshipSnapshotEvidence } from "./dockerComposeRelationshipSnapshotEvidence";

export type DockerComposeRelationshipPresentationRow = {
  composePath: string;
  fromService: string;
  toService: string;
  targetState: "present" | "missing";
  syntax: "list" | "mapping" | "inline-list";
};

export type DockerComposeRelationshipSnapshotPresentation = {
  schema: "solvelang.repository-audit.docker-compose-relationship-presentation.v0";
  mode: "analyze-only";
  source: DockerComposeRelationshipSnapshotEvidence["source"];
  status: DockerComposeRelationshipSnapshotEvidence["status"];
  summary: {
    composeFiles: number;
    servicesSeen: number;
    relationshipsSeen: number;
    relationshipsReturnedByEvidence: number;
    relationshipsHiddenByEvidenceBound: number;
    missingTargets: number;
    unsupportedReferences: number;
    composeFilesSkipped: number;
    composeFilesOmittedByFileBound: number;
    rowsShown: number;
    rowsHiddenByPresentationBound: number;
  };
  rows: DockerComposeRelationshipPresentationRow[];
  notices: string[];
  execution: {
    composeEvaluation: false;
    containerStart: false;
    networkAccess: false;
    writeAccess: false;
    maxRows: number;
    rowsTruncated: boolean;
    sourcePartial: boolean;
  };
};

export type DockerComposeRelationshipSnapshotPresentationOptions = {
  maxRows?: number;
};

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRows(
  left: DockerComposeRelationshipPresentationRow,
  right: DockerComposeRelationshipPresentationRow,
): number {
  return compareText(left.composePath, right.composePath)
    || compareText(left.fromService, right.fromService)
    || compareText(left.toService, right.toService)
    || compareText(left.targetState, right.targetState)
    || compareText(left.syntax, right.syntax);
}

function createNotices(
  evidence: DockerComposeRelationshipSnapshotEvidence,
  rowsTruncated: boolean,
): string[] {
  const notices: string[] = [];
  if (evidence.status === "absent") {
    notices.push("No conventional Docker Compose YAML files were present in the supplied repository snapshot.");
  }
  if (evidence.summary.composeFilesSkipped > 0) {
    notices.push(`${evidence.summary.composeFilesSkipped} Compose file(s) were skipped because bounded source text was unavailable or oversized.`);
  }
  if (evidence.summary.composeFilesOmittedByFileBound > 0) {
    notices.push(`${evidence.summary.composeFilesOmittedByFileBound} Compose file(s) were omitted by the snapshot file bound.`);
  }
  if (evidence.summary.unsupportedReferences > 0) {
    notices.push(`${evidence.summary.unsupportedReferences} dynamic or unsupported depends_on reference(s) were skipped instead of guessed.`);
  }
  if (evidence.summary.relationshipsHidden > 0) {
    notices.push(`${evidence.summary.relationshipsHidden} depends_on relationship(s) were hidden by evidence bounds before presentation.`);
  }
  if (evidence.summary.missingTargets > 0) {
    notices.push(`${evidence.summary.missingTargets} returned depends_on target(s) were not declared as services in the same bounded Compose file.`);
  }
  if (rowsTruncated) {
    notices.push("This presentation shows only the first deterministic bounded subset of returned Compose relationships.");
  }
  notices.push("Compose service dependencies are presented as static supplied evidence only; interpolation, anchors, profiles, runtime readiness, container starts, and network state are not evaluated.");
  return notices;
}

export function createDockerComposeRelationshipSnapshotPresentation(
  evidence: DockerComposeRelationshipSnapshotEvidence,
  options: DockerComposeRelationshipSnapshotPresentationOptions = {},
): DockerComposeRelationshipSnapshotPresentation {
  const maxRows = boundedInteger(
    options.maxRows,
    200,
    1,
    2_000,
    "Docker Compose relationship presentation maxRows",
  );
  const allRows = evidence.files
    .flatMap((file) => file.evidence.relationships.map((relationship) => ({
      composePath: file.path,
      fromService: relationship.fromService,
      toService: relationship.toService,
      targetState: relationship.targetState,
      syntax: relationship.evidence.syntax,
    })))
    .sort(compareRows);
  const rowsTruncated = allRows.length > maxRows;
  const rows = allRows.slice(0, maxRows);

  return {
    schema: "solvelang.repository-audit.docker-compose-relationship-presentation.v0",
    mode: "analyze-only",
    source: { ...evidence.source },
    status: evidence.status,
    summary: {
      composeFiles: evidence.files.length,
      servicesSeen: evidence.summary.servicesSeen,
      relationshipsSeen: evidence.summary.relationshipsSeen,
      relationshipsReturnedByEvidence: evidence.summary.relationshipsReturned,
      relationshipsHiddenByEvidenceBound: evidence.summary.relationshipsHidden,
      missingTargets: evidence.summary.missingTargets,
      unsupportedReferences: evidence.summary.unsupportedReferences,
      composeFilesSkipped: evidence.summary.composeFilesSkipped,
      composeFilesOmittedByFileBound: evidence.summary.composeFilesOmittedByFileBound,
      rowsShown: rows.length,
      rowsHiddenByPresentationBound: Math.max(0, allRows.length - rows.length),
    },
    rows,
    notices: createNotices(evidence, rowsTruncated),
    execution: {
      composeEvaluation: false,
      containerStart: false,
      networkAccess: false,
      writeAccess: false,
      maxRows,
      rowsTruncated,
      sourcePartial: evidence.status === "partial",
    },
  };
}
