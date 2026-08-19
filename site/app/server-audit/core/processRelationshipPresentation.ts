import type {
  ServerAuditProcessRelationship,
  ServerAuditProcessRelationshipAnalysis,
} from "./processRelationships";

export type ServerAuditProcessRelationshipPresentationRow = {
  id: string;
  kind: ServerAuditProcessRelationship["kind"];
  sources: string[];
  sourcesTruncated: boolean;
};

export type ServerAuditProcessRelationshipPresentationOptions = {
  maxRows?: number;
};

export type ServerAuditProcessRelationshipPresentation = {
  schema: "solvelang.server-audit.process-relationship-presentation.v0";
  mode: "analyze-only";
  status: "complete" | "partial";
  rows: ServerAuditProcessRelationshipPresentationRow[];
  notices: string[];
  summary: {
    relationships: number;
    parentRelationships: number;
    listenerRelationships: number;
    ambiguousListenerRelationships: number;
    shownRows: number;
    hiddenRows: number;
    unresolvedListenerAttributions: number;
    duplicateProcessIdsSkipped: number;
    invalidProcessLabelsSkipped: number;
    invalidListenerLabelsSkipped: number;
    relationshipsWithTruncatedSources: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxRows: number;
    rowsTruncated: boolean;
    sourcePartial: boolean;
  };
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

function row(relationship: ServerAuditProcessRelationship): ServerAuditProcessRelationshipPresentationRow {
  return {
    id: relationship.id,
    kind: relationship.kind,
    sources: [...relationship.sources],
    sourcesTruncated: relationship.sourcesTruncated === true,
  };
}

function createNotices(
  analysis: ServerAuditProcessRelationshipAnalysis,
  rowsTruncated: boolean,
): string[] {
  const notices: string[] = [];
  if (analysis.execution.relationshipsTruncated) {
    notices.push("Process relationship analysis reached its configured relationship limit; additional structural relationships may exist.");
  }
  if (analysis.summary.relationshipsWithTruncatedSources > 0) {
    notices.push(`${analysis.summary.relationshipsWithTruncatedSources} relationship(s) exceeded the bounded structural source fanout.`);
  }
  if (analysis.summary.ambiguousListenerAttributions > 0) {
    notices.push(`${analysis.summary.ambiguousListenerAttributions} listening socket attribution(s) matched multiple process inventory entries and remain explicitly ambiguous.`);
  }
  if (analysis.summary.unresolvedListenerAttributions > 0) {
    notices.push(`${analysis.summary.unresolvedListenerAttributions} listening socket attribution(s) could not be resolved to the bounded process inventory.`);
  }
  if (analysis.summary.duplicateProcessIdsSkipped > 0) {
    notices.push(`${analysis.summary.duplicateProcessIdsSkipped} process inventory row(s) used duplicate process IDs and were excluded from parent attribution rather than guessed.`);
  }
  if (analysis.summary.invalidProcessLabelsSkipped > 0) {
    notices.push(`${analysis.summary.invalidProcessLabelsSkipped} process label(s) were rejected by the bounded privacy/normalization contract.`);
  }
  if (analysis.summary.invalidListenerLabelsSkipped > 0) {
    notices.push(`${analysis.summary.invalidListenerLabelsSkipped} listening-socket process label(s) were rejected by the bounded privacy/normalization contract.`);
  }
  if (rowsTruncated) {
    notices.push("This presentation shows only the first bounded subset of analyzed process relationships.");
  }
  return notices;
}

export function createServerAuditProcessRelationshipPresentation(
  analysis: ServerAuditProcessRelationshipAnalysis,
  options: ServerAuditProcessRelationshipPresentationOptions = {},
): ServerAuditProcessRelationshipPresentation {
  if (analysis.mode !== "analyze-only"
    || analysis.execution.networkAccess !== false
    || analysis.execution.writeAccess !== false) {
    throw new Error("Server Audit process relationship presentation requires analyze-only input with networkAccess=false and writeAccess=false.");
  }

  const maxRows = boundedInteger(
    options.maxRows,
    100,
    1,
    1_000,
    "Server Audit process relationship presentation maxRows",
  );
  const ordered = [...analysis.relationships].sort((left, right) => compareText(left.id, right.id));
  const rowsTruncated = ordered.length > maxRows;
  const rows = ordered.slice(0, maxRows).map(row);
  const sourcePartial = analysis.execution.relationshipsTruncated
    || analysis.summary.relationshipsWithTruncatedSources > 0
    || analysis.summary.ambiguousListenerAttributions > 0
    || analysis.summary.unresolvedListenerAttributions > 0
    || analysis.summary.duplicateProcessIdsSkipped > 0
    || analysis.summary.invalidProcessLabelsSkipped > 0
    || analysis.summary.invalidListenerLabelsSkipped > 0;

  return {
    schema: "solvelang.server-audit.process-relationship-presentation.v0",
    mode: "analyze-only",
    status: sourcePartial || rowsTruncated ? "partial" : "complete",
    rows,
    notices: createNotices(analysis, rowsTruncated),
    summary: {
      relationships: ordered.length,
      parentRelationships: ordered.filter(({ kind }) => kind === "parent-process").length,
      listenerRelationships: ordered.filter(({ kind }) => kind === "listener-process").length,
      ambiguousListenerRelationships: ordered.filter(({ kind }) => kind === "ambiguous-listener-process").length,
      shownRows: rows.length,
      hiddenRows: Math.max(0, ordered.length - rows.length),
      unresolvedListenerAttributions: analysis.summary.unresolvedListenerAttributions,
      duplicateProcessIdsSkipped: analysis.summary.duplicateProcessIdsSkipped,
      invalidProcessLabelsSkipped: analysis.summary.invalidProcessLabelsSkipped,
      invalidListenerLabelsSkipped: analysis.summary.invalidListenerLabelsSkipped,
      relationshipsWithTruncatedSources: analysis.summary.relationshipsWithTruncatedSources,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRows,
      rowsTruncated,
      sourcePartial,
    },
  };
}
