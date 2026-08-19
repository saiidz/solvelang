import type {
  RepositoryArchitecturePathAnalysis,
  RepositoryArchitecturePathSummary,
} from "./architecturePaths";

export type RepositoryArchitecturePathPresentationRow = {
  classification: RepositoryArchitecturePathSummary["classification"];
  root: {
    nodeId: string;
    kind: RepositoryArchitecturePathSummary["root"]["kind"];
    label: string;
  };
  target: {
    nodeId: string;
    kind: RepositoryArchitecturePathSummary["target"]["kind"];
    label: string;
  };
  depth: number;
  relationshipKinds: RepositoryArchitecturePathSummary["segments"][number]["kind"][];
  evidence: Array<{
    path: string;
    line?: number;
  }>;
};

export type RepositoryArchitecturePathPresentation = {
  schema: "solvelang.repository-audit.architecture-path-presentation.v0";
  mode: "analyze-only";
  graphId: string;
  status: RepositoryArchitecturePathAnalysis["status"];
  summary: {
    architecturePaths: number;
    securityBoundaryPaths: number;
    rowsShown: number;
    rowsHidden: number;
  };
  rows: RepositoryArchitecturePathPresentationRow[];
  notices: string[];
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxRows: number;
    rowsTruncated: boolean;
    sourcePartial: boolean;
  };
};

export type RepositoryArchitecturePathPresentationOptions = {
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

function comparePaths(
  left: RepositoryArchitecturePathSummary,
  right: RepositoryArchitecturePathSummary,
): number {
  return compareText(left.root.nodeId, right.root.nodeId)
    || left.depth - right.depth
    || compareText(left.target.nodeId, right.target.nodeId)
    || compareText(
      left.segments.map((segment) => segment.edgeId).join("|"),
      right.segments.map((segment) => segment.edgeId).join("|"),
    );
}

function label(node: RepositoryArchitecturePathSummary["root"]): string {
  return node.path || node.nodeId;
}

function row(path: RepositoryArchitecturePathSummary): RepositoryArchitecturePathPresentationRow {
  const seenEvidence = new Set<string>();
  const evidence: RepositoryArchitecturePathPresentationRow["evidence"] = [];
  for (const segment of path.segments) {
    if (!segment.evidence) continue;
    const key = `${segment.evidence.path}:${segment.evidence.line ?? ""}`;
    if (seenEvidence.has(key)) continue;
    seenEvidence.add(key);
    evidence.push({
      path: segment.evidence.path,
      ...(segment.evidence.line === undefined ? {} : { line: segment.evidence.line }),
    });
  }
  return {
    classification: path.classification,
    root: {
      nodeId: path.root.nodeId,
      kind: path.root.kind,
      label: label(path.root),
    },
    target: {
      nodeId: path.target.nodeId,
      kind: path.target.kind,
      label: label(path.target),
    },
    depth: path.depth,
    relationshipKinds: path.segments.map((segment) => segment.kind),
    evidence,
  };
}

function notices(
  analysis: RepositoryArchitecturePathAnalysis,
  rowsTruncated: boolean,
): string[] {
  const values: string[] = [];
  if (analysis.execution.graphTruncated) {
    values.push("The underlying repository graph is partial; architecture path coverage may be incomplete.");
  }
  if (analysis.execution.rootsTruncated) {
    values.push("Only a bounded subset of route, workflow, and job roots was analyzed.");
  }
  if (analysis.execution.traversalTruncated) {
    values.push("At least one bounded graph traversal reached its result limit.");
  }
  if (analysis.execution.pathsTruncated) {
    values.push("The architecture analyzer omitted paths beyond its configured path limit.");
  }
  if (rowsTruncated) {
    values.push("This presentation shows only the first bounded subset of analyzed paths.");
  }
  return values;
}

export function createRepositoryArchitecturePathPresentation(
  analysis: RepositoryArchitecturePathAnalysis,
  options: RepositoryArchitecturePathPresentationOptions = {},
): RepositoryArchitecturePathPresentation {
  const maxRows = boundedInteger(
    options.maxRows,
    100,
    1,
    1_000,
    "Repository architecture presentation maxRows",
  );
  const orderedPaths = [...analysis.paths].sort(comparePaths);
  const rowsTruncated = orderedPaths.length > maxRows;
  const rows = orderedPaths.slice(0, maxRows).map(row);

  return {
    schema: "solvelang.repository-audit.architecture-path-presentation.v0",
    mode: "analyze-only",
    graphId: analysis.graphId,
    status: analysis.status,
    summary: {
      architecturePaths: analysis.summary.architecturePaths,
      securityBoundaryPaths: analysis.summary.securityBoundaryPaths,
      rowsShown: rows.length,
      rowsHidden: Math.max(0, orderedPaths.length - rows.length),
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
