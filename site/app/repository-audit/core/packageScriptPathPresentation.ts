import type {
  RepositoryPackageScriptPathEvidence,
  RepositoryPackageScriptPathEvidenceAnalysis,
} from "./packageScriptPathEvidence";

export type RepositoryPackageScriptPathPresentationRow = {
  evidenceId: string;
  kind: RepositoryPackageScriptPathEvidence["kind"];
  fromPath: string;
  scriptName: string;
  targetPath: string;
  targetState: RepositoryPackageScriptPathEvidence["targetState"];
  evidence: {
    path: string;
    field: string;
  };
};

export type RepositoryPackageScriptPathPresentation = {
  schema: "solvelang.repository-audit.package-script-path-presentation.v0";
  mode: "analyze-only";
  graphId: string;
  status: RepositoryPackageScriptPathEvidenceAnalysis["status"];
  summary: {
    relationships: number;
    presentTargets: number;
    outsideBoundedScanTargets: number;
    missingTargets: number;
    rowsShown: number;
    rowsHidden: number;
    skippedMissingText: number;
    skippedOversizedPackageText: number;
    skippedOversizedScripts: number;
    skippedInvalidJson: number;
    skippedDynamicScripts: number;
    skippedInvalidTargets: number;
  };
  rows: RepositoryPackageScriptPathPresentationRow[];
  notices: string[];
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxRows: number;
    rowsTruncated: boolean;
    sourcePartial: boolean;
  };
};

export type RepositoryPackageScriptPathPresentationOptions = {
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
  left: RepositoryPackageScriptPathEvidence,
  right: RepositoryPackageScriptPathEvidence,
): number {
  return compareText(left.fromPath, right.fromPath)
    || compareText(left.scriptName, right.scriptName)
    || compareText(left.kind, right.kind)
    || compareText(left.targetPath, right.targetPath)
    || compareText(left.evidenceId, right.evidenceId);
}

function row(
  relationship: RepositoryPackageScriptPathEvidence,
): RepositoryPackageScriptPathPresentationRow {
  return {
    evidenceId: relationship.evidenceId,
    kind: relationship.kind,
    fromPath: relationship.fromPath,
    scriptName: relationship.scriptName,
    targetPath: relationship.targetPath,
    targetState: relationship.targetState,
    evidence: {
      path: relationship.evidence.path,
      field: relationship.evidence.field,
    },
  };
}

function notices(
  analysis: RepositoryPackageScriptPathEvidenceAnalysis,
  rowsTruncated: boolean,
): string[] {
  const values: string[] = [];
  if (analysis.execution.graphTruncated) {
    values.push("The underlying repository graph is partial; package-script path coverage may be incomplete.");
  }
  if (analysis.execution.relationshipsTruncated) {
    values.push("The package-script path analyzer omitted relationships beyond its configured relationship limit.");
  }
  if (analysis.skipped.missingText > 0) {
    values.push(`${analysis.skipped.missingText} package.json file(s) lacked readable text and were skipped.`);
  }
  if (analysis.skipped.oversizedPackageText > 0) {
    values.push(`${analysis.skipped.oversizedPackageText} package.json file(s) exceeded the configured package-text limit and were skipped.`);
  }
  if (analysis.skipped.oversizedScript > 0) {
    values.push(`${analysis.skipped.oversizedScript} package script(s) exceeded the configured script-text limit and were skipped.`);
  }
  if (analysis.skipped.invalidJson > 0) {
    values.push(`${analysis.skipped.invalidJson} package.json file(s) contained invalid JSON and were skipped.`);
  }
  if (analysis.skipped.dynamicScript > 0) {
    values.push(`${analysis.skipped.dynamicScript} shell-heavy or dynamic package script(s) were skipped rather than executed or guessed.`);
  }
  if (analysis.skipped.invalidTarget > 0) {
    values.push(`${analysis.skipped.invalidTarget} package-script path reference(s) were rejected as non-local or ambiguous.`);
  }
  if (rowsTruncated) {
    values.push("This presentation shows only the first bounded subset of analyzed package-script path relationships.");
  }
  return values;
}

export function createRepositoryPackageScriptPathPresentation(
  analysis: RepositoryPackageScriptPathEvidenceAnalysis,
  options: RepositoryPackageScriptPathPresentationOptions = {},
): RepositoryPackageScriptPathPresentation {
  const maxRows = boundedInteger(
    options.maxRows,
    100,
    1,
    1_000,
    "Repository package script path presentation maxRows",
  );
  const orderedRelationships = [...analysis.relationships].sort(compareRelationships);
  const rowsTruncated = orderedRelationships.length > maxRows;
  const rows = orderedRelationships.slice(0, maxRows).map(row);

  return {
    schema: "solvelang.repository-audit.package-script-path-presentation.v0",
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
      skippedOversizedPackageText: analysis.skipped.oversizedPackageText,
      skippedOversizedScripts: analysis.skipped.oversizedScript,
      skippedInvalidJson: analysis.skipped.invalidJson,
      skippedDynamicScripts: analysis.skipped.dynamicScript,
      skippedInvalidTargets: analysis.skipped.invalidTarget,
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
