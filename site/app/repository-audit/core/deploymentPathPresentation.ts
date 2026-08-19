import type {
  RepositoryDeploymentPathEvidence,
  RepositoryDeploymentPathEvidenceAnalysis,
} from "./deploymentPathEvidence";

export type RepositoryDeploymentPathPresentationRow = {
  evidenceId: string;
  kind: RepositoryDeploymentPathEvidence["kind"];
  fromPath: string;
  targetPath: string;
  targetType: RepositoryDeploymentPathEvidence["targetType"];
  targetState: RepositoryDeploymentPathEvidence["targetState"];
  evidence: {
    path: string;
    line?: number;
    field?: string;
  };
};

export type RepositoryDeploymentPathPresentation = {
  schema: "solvelang.repository-audit.deployment-path-presentation.v0";
  mode: "analyze-only";
  graphId: string;
  status: RepositoryDeploymentPathEvidenceAnalysis["status"];
  summary: {
    relationships: number;
    presentTargets: number;
    outsideBoundedScanTargets: number;
    missingTargets: number;
    rowsShown: number;
    rowsHidden: number;
    skippedDynamicReferences: number;
  };
  rows: RepositoryDeploymentPathPresentationRow[];
  notices: string[];
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxRows: number;
    rowsTruncated: boolean;
    sourcePartial: boolean;
  };
};

export type RepositoryDeploymentPathPresentationOptions = {
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

function compareRelationships(
  left: RepositoryDeploymentPathEvidence,
  right: RepositoryDeploymentPathEvidence,
): number {
  return compareText(left.fromPath, right.fromPath)
    || (left.evidence.line ?? Number.MAX_SAFE_INTEGER) - (right.evidence.line ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.kind, right.kind)
    || compareText(left.targetPath, right.targetPath)
    || compareText(left.evidenceId, right.evidenceId);
}

function row(relationship: RepositoryDeploymentPathEvidence): RepositoryDeploymentPathPresentationRow {
  return {
    evidenceId: relationship.evidenceId,
    kind: relationship.kind,
    fromPath: relationship.fromPath,
    targetPath: relationship.targetPath,
    targetType: relationship.targetType,
    targetState: relationship.targetState,
    evidence: {
      path: relationship.evidence.path,
      ...(relationship.evidence.line === undefined ? {} : { line: relationship.evidence.line }),
      ...(relationship.evidence.field === undefined ? {} : { field: relationship.evidence.field }),
    },
  };
}

function notices(
  analysis: RepositoryDeploymentPathEvidenceAnalysis,
  rowsTruncated: boolean,
): string[] {
  const values: string[] = [];
  if (analysis.execution.graphTruncated) {
    values.push("The underlying repository graph is partial; deployment path coverage may be incomplete.");
  }
  if (analysis.execution.relationshipsTruncated) {
    values.push("The deployment path analyzer omitted relationships beyond its configured relationship limit.");
  }
  if (analysis.skipped.dynamicReference > 0) {
    values.push(`${analysis.skipped.dynamicReference} dynamic or ambiguous deployment reference(s) were skipped rather than guessed.`);
  }
  if (rowsTruncated) {
    values.push("This presentation shows only the first bounded subset of analyzed deployment relationships.");
  }
  return values;
}

export function createRepositoryDeploymentPathPresentation(
  analysis: RepositoryDeploymentPathEvidenceAnalysis,
  options: RepositoryDeploymentPathPresentationOptions = {},
): RepositoryDeploymentPathPresentation {
  const maxRows = boundedInteger(
    options.maxRows,
    100,
    1,
    1_000,
    "Repository deployment path presentation maxRows",
  );
  const orderedRelationships = [...analysis.relationships].sort(compareRelationships);
  const rowsTruncated = orderedRelationships.length > maxRows;
  const rows = orderedRelationships.slice(0, maxRows).map(row);

  return {
    schema: "solvelang.repository-audit.deployment-path-presentation.v0",
    mode: "analyze-only",
    graphId: analysis.graphId,
    status: analysis.status,
    summary: {
      relationships: orderedRelationships.length,
      presentTargets: orderedRelationships.filter(({ targetState }) => targetState === "present").length,
      outsideBoundedScanTargets: orderedRelationships.filter(({ targetState }) => targetState === "outside-bounded-scan").length,
      missingTargets: orderedRelationships.filter(({ targetState }) => targetState === "missing").length,
      rowsShown: rows.length,
      rowsHidden: Math.max(0, orderedRelationships.length - rows.length),
      skippedDynamicReferences: analysis.skipped.dynamicReference,
    },
    rows,
    notices: notices(analysis, rowsTruncated),
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRows,
      rowsTruncated,
      sourcePartial: analysis.status === "partial",
    },
  };
}
