import type { DockerComposeSnapshotEvidence } from "./dockerComposeSnapshotEvidence";

export type DockerComposeSnapshotPresentationRow = {
  composePath: string;
  serviceName: string;
  image?: string;
  imageState: "declared" | "unresolved";
};

export type DockerComposeSnapshotPresentation = {
  schema: "solvelang.repository-audit.docker-compose-presentation.v0";
  mode: "analyze-only";
  source: DockerComposeSnapshotEvidence["source"];
  status: DockerComposeSnapshotEvidence["status"];
  summary: {
    composeFiles: number;
    services: number;
    declaredImages: number;
    unresolvedImages: number;
    composeFilesSkipped: number;
    composeFilesOmittedByFileBound: number;
    rowsShown: number;
    rowsHidden: number;
  };
  rows: DockerComposeSnapshotPresentationRow[];
  notices: string[];
  execution: {
    containerBuild: false;
    imageResolution: false;
    networkAccess: false;
    writeAccess: false;
    maxRows: number;
    rowsTruncated: boolean;
    sourcePartial: boolean;
  };
};

export type DockerComposeSnapshotPresentationOptions = {
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
  left: DockerComposeSnapshotPresentationRow,
  right: DockerComposeSnapshotPresentationRow,
): number {
  return compareText(left.composePath, right.composePath)
    || compareText(left.serviceName, right.serviceName)
    || compareText(left.imageState, right.imageState)
    || compareText(left.image ?? "", right.image ?? "");
}

function createNotices(
  evidence: DockerComposeSnapshotEvidence,
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
  if (evidence.files.some((file) => file.evidence.truncated)) {
    notices.push("At least one Compose file contains additional services beyond the bounded service-evidence limit.");
  }
  if (rowsTruncated) {
    notices.push("This presentation shows only the first deterministic bounded subset of analyzed Compose services.");
  }
  notices.push("Compose configuration is presented as static supplied evidence only; substitutions, anchors, image resolution, pulls, builds, and container starts are not evaluated or executed.");
  return notices;
}

export function createDockerComposeSnapshotPresentation(
  evidence: DockerComposeSnapshotEvidence,
  options: DockerComposeSnapshotPresentationOptions = {},
): DockerComposeSnapshotPresentation {
  const maxRows = boundedInteger(
    options.maxRows,
    200,
    1,
    2_000,
    "Docker Compose snapshot presentation maxRows",
  );
  const allRows = evidence.files
    .flatMap((file) => file.evidence.services.map((service) => ({
      composePath: file.path,
      serviceName: service.name,
      ...(service.image === undefined ? {} : { image: service.image }),
      imageState: service.imageState,
    })))
    .sort(compareRows);
  const rowsTruncated = allRows.length > maxRows;
  const rows = allRows.slice(0, maxRows);

  return {
    schema: "solvelang.repository-audit.docker-compose-presentation.v0",
    mode: "analyze-only",
    source: { ...evidence.source },
    status: evidence.status,
    summary: {
      composeFiles: evidence.files.length,
      services: allRows.length,
      declaredImages: allRows.filter((row) => row.imageState === "declared").length,
      unresolvedImages: allRows.filter((row) => row.imageState === "unresolved").length,
      composeFilesSkipped: evidence.summary.composeFilesSkipped,
      composeFilesOmittedByFileBound: evidence.summary.composeFilesOmittedByFileBound,
      rowsShown: rows.length,
      rowsHidden: Math.max(0, allRows.length - rows.length),
    },
    rows,
    notices: createNotices(evidence, rowsTruncated),
    execution: {
      containerBuild: false,
      imageResolution: false,
      networkAccess: false,
      writeAccess: false,
      maxRows,
      rowsTruncated,
      sourcePartial: evidence.status === "partial",
    },
  };
}
