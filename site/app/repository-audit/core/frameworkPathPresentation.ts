import type {
  RepositoryFrameworkPathEvidence,
  RepositoryFrameworkPathEvidenceAnalysis,
} from "./frameworkPathEvidence";

export type RepositoryFrameworkPathPresentationRow = {
  evidenceId: string;
  kind: RepositoryFrameworkPathEvidence["kind"];
  framework: RepositoryFrameworkPathEvidence["framework"];
  fromPath: string;
  targetPath: string;
  targetType: RepositoryFrameworkPathEvidence["targetType"];
  targetState: RepositoryFrameworkPathEvidence["targetState"];
  evidence: {
    path: string;
    field: string;
  };
};

export type RepositoryFrameworkPathPresentation = {
  schema: "solvelang.repository-audit.framework-path-presentation.v0";
  mode: "analyze-only";
  graphId: string;
  status: RepositoryFrameworkPathEvidenceAnalysis["status"];
  summary: {
    relationships: number;
    angularRelationships: number;
    nestRelationships: number;
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
  rows: RepositoryFrameworkPathPresentationRow[];
  notices: string[];
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxRows: number;
    rowsTruncated: boolean;
    sourcePartial: boolean;
  };
};

export type RepositoryFrameworkPathPresentationOptions = {
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
  left: RepositoryFrameworkPathEvidence,
  right: RepositoryFrameworkPathEvidence,
): number {
  return compareText(left.framework, right.framework)
    || compareText(left.fromPath, right.fromPath)
    || compareText(left.evidence.field, right.evidence.field)
    || compareText(left.kind, right.kind)
    || compareText(left.targetPath, right.targetPath)
    || compareText(left.evidenceId, right.evidenceId);
}

function row(relationship: RepositoryFrameworkPathEvidence): RepositoryFrameworkPathPresentationRow {
  return {
    evidenceId: relationship.evidenceId,
    kind: relationship.kind,
    framework: relationship.framework,
    fromPath: relationship.fromPath,
    targetPath: relationship.targetPath,
    targetType: relationship.targetType,
    targetState: relationship.targetState,
    evidence: {
      path: relationship.evidence.path,
      field: relationship.evidence.field,
    },
  };
}

function notices(
  analysis: RepositoryFrameworkPathEvidenceAnalysis,
  rowsTruncated: boolean,
): string[] {
  const values: string[] = [];
  if (analysis.execution.graphTruncated) {
    values.push("The underlying repository graph is partial; framework path coverage may be incomplete.");
  }
  if (analysis.execution.relationshipsTruncated) {
    values.push("The framework path analyzer omitted relationships beyond its configured relationship limit.");
  }
  if (analysis.skipped.missingText > 0) {
    values.push(`${analysis.skipped.missingText} framework configuration file(s) lacked readable text and were skipped.`);
  }
  if (analysis.skipped.oversizedText > 0) {
    values.push(`${analysis.skipped.oversizedText} framework configuration file(s) exceeded the configured text limit and were skipped.`);
  }
  if (analysis.skipped.invalidJson > 0) {
    values.push(`${analysis.skipped.invalidJson} framework configuration file(s) contained invalid JSON and were skipped.`);
  }
  if (analysis.skipped.dynamicReference > 0) {
    values.push(`${analysis.skipped.dynamicReference} dynamic or ambiguous framework reference(s) were skipped rather than guessed.`);
  }
  if (rowsTruncated) {
    values.push("This presentation shows only the first bounded subset of analyzed framework relationships.");
  }
  return values;
}

export function createRepositoryFrameworkPathPresentation(
  analysis: RepositoryFrameworkPathEvidenceAnalysis,
  options: RepositoryFrameworkPathPresentationOptions = {},
): RepositoryFrameworkPathPresentation {
  const maxRows = boundedInteger(
    options.maxRows,
    100,
    1,
    1_000,
    "Repository framework path presentation maxRows",
  );
  const orderedRelationships = [...analysis.relationships].sort(compareRelationships);
  const rowsTruncated = orderedRelationships.length > maxRows;
  const rows = orderedRelationships.slice(0, maxRows).map(row);

  return {
    schema: "solvelang.repository-audit.framework-path-presentation.v0",
    mode: "analyze-only",
    graphId: analysis.graphId,
    status: analysis.status,
    summary: {
      relationships: orderedRelationships.length,
      angularRelationships: orderedRelationships.filter(({ framework }) => framework === "angular").length,
      nestRelationships: orderedRelationships.filter(({ framework }) => framework === "nest").length,
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
