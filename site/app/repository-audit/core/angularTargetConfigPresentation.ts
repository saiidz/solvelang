import type {
  RepositoryAngularTargetConfigEvidence,
  RepositoryAngularTargetConfigEvidenceAnalysis,
} from "./angularTargetConfigEvidence";

export type RepositoryAngularTargetConfigPresentationRow = {
  evidenceId: string;
  project: string;
  target: string;
  fromPath: string;
  targetPath: string;
  targetState: RepositoryAngularTargetConfigEvidence["targetState"];
  evidence: {
    path: string;
    field: string;
  };
};

export type RepositoryAngularTargetConfigPresentation = {
  schema: "solvelang.repository-audit.angular-target-config-presentation.v0";
  mode: "analyze-only";
  graphId: string;
  status: RepositoryAngularTargetConfigEvidenceAnalysis["status"];
  summary: {
    relationships: number;
    presentTargets: number;
    outsideBoundedScanTargets: number;
    missingTargets: number;
    rowsShown: number;
    rowsHidden: number;
    skippedMissingText: number;
    skippedOversizedText: number;
    skippedInvalidJson: number;
    skippedDynamicReferences: number;
  };
  rows: RepositoryAngularTargetConfigPresentationRow[];
  notices: string[];
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxRows: number;
    rowsTruncated: boolean;
    sourcePartial: boolean;
  };
};

export type RepositoryAngularTargetConfigPresentationOptions = {
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
  left: RepositoryAngularTargetConfigEvidence,
  right: RepositoryAngularTargetConfigEvidence,
): number {
  return compareText(left.fromPath, right.fromPath)
    || compareText(left.project, right.project)
    || compareText(left.target, right.target)
    || compareText(left.targetPath, right.targetPath)
    || compareText(left.evidenceId, right.evidenceId);
}

function row(
  relationship: RepositoryAngularTargetConfigEvidence,
): RepositoryAngularTargetConfigPresentationRow {
  return {
    evidenceId: relationship.evidenceId,
    project: relationship.project,
    target: relationship.target,
    fromPath: relationship.fromPath,
    targetPath: relationship.targetPath,
    targetState: relationship.targetState,
    evidence: {
      path: relationship.evidence.path,
      field: relationship.evidence.field,
    },
  };
}

function notices(
  analysis: RepositoryAngularTargetConfigEvidenceAnalysis,
  rowsTruncated: boolean,
): string[] {
  const values: string[] = [];
  if (analysis.execution.graphTruncated) {
    values.push("The underlying repository graph is partial; Angular target-config coverage may be incomplete.");
  }
  if (analysis.execution.relationshipsTruncated) {
    values.push("The Angular target-config analyzer omitted relationships beyond its configured relationship limit.");
  }
  if (analysis.skipped.missingText > 0) {
    values.push(`${analysis.skipped.missingText} Angular configuration file(s) lacked readable text and were skipped.`);
  }
  if (analysis.skipped.oversizedText > 0) {
    values.push(`${analysis.skipped.oversizedText} Angular configuration file(s) exceeded the configured text limit and were skipped.`);
  }
  if (analysis.skipped.invalidJson > 0) {
    values.push(`${analysis.skipped.invalidJson} Angular configuration file(s) contained invalid JSON and were skipped.`);
  }
  if (analysis.skipped.dynamicReference > 0) {
    values.push(`${analysis.skipped.dynamicReference} dynamic or ambiguous Angular target-config reference(s) were skipped rather than guessed.`);
  }
  if (rowsTruncated) {
    values.push("This presentation shows only the first bounded subset of analyzed Angular target-config relationships.");
  }
  return values;
}

export function createRepositoryAngularTargetConfigPresentation(
  analysis: RepositoryAngularTargetConfigEvidenceAnalysis,
  options: RepositoryAngularTargetConfigPresentationOptions = {},
): RepositoryAngularTargetConfigPresentation {
  const maxRows = boundedInteger(
    options.maxRows,
    100,
    1,
    1_000,
    "Repository Angular target config presentation maxRows",
  );
  const orderedRelationships = [...analysis.relationships].sort(compareRelationships);
  const rowsTruncated = orderedRelationships.length > maxRows;
  const rows = orderedRelationships.slice(0, maxRows).map(row);

  return {
    schema: "solvelang.repository-audit.angular-target-config-presentation.v0",
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
      skippedMissingText: analysis.skipped.missingText,
      skippedOversizedText: analysis.skipped.oversizedText,
      skippedInvalidJson: analysis.skipped.invalidJson,
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
