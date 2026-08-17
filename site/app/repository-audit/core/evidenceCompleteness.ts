import type { RepositoryAuditAnalysisResult } from "./analysisPipeline";

export type RepositoryAuditEvidenceLimitation = {
  scope: "inventory" | "graph";
  reason: string;
  message: string;
};

export type RepositoryAuditEvidenceCompleteness = {
  schema: "solvelang.repository-audit.evidence-completeness.v0";
  mode: "analyze-only";
  status: "complete" | "partial";
  truncated: boolean;
  source: {
    fingerprint: string;
    revision: string;
  };
  inventory: {
    status: "complete" | "partial";
    truncated: boolean;
    truncationReasons: string[];
    filesSeen: number;
    filesScanned: number;
    filesSkipped: number;
    bytesScanned: number;
  };
  graph: {
    status: "complete" | "partial";
    truncated: boolean;
    truncationReasons: string[];
    fileNodes: number;
    nodes: number;
    edges: number;
    extractors: Array<{ id: string; version: string }>;
  };
  secretAnalysis: {
    scope: "graph-accepted-files-only";
    filesScanned: number;
    redactedMatches: number;
  };
  limitations: RepositoryAuditEvidenceLimitation[];
  safety: {
    networkAccess: false;
    writeAccess: false;
  };
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function limitationMessage(reason: string): string {
  switch (reason) {
    case "file-count": return "The configured file-count limit prevented complete evidence collection.";
    case "total-bytes": return "The configured total-byte limit prevented complete evidence collection.";
    case "file-size": return "At least one file exceeded the configured per-file evidence limit.";
    case "depth": return "At least one repository path exceeded the configured depth limit.";
    case "finding-count": return "The configured inventory finding limit was reached.";
    case "node-count": return "The configured graph node limit was reached.";
    case "edge-count": return "The configured graph edge limit was reached.";
    case "evidence-count": return "The configured graph evidence limit was reached.";
    case "metadata-count": return "The configured graph metadata limit was reached.";
    default: return "A bounded scan limit prevented complete evidence collection.";
  }
}

function assertExecutionTruth(analysis: RepositoryAuditAnalysisResult): void {
  const inventoryPartial = analysis.inventory.execution.status === "partial";
  const graphPartial = analysis.graph.execution.status === "partial";
  const overallPartial = analysis.execution.status === "partial";

  if (inventoryPartial !== analysis.inventory.execution.truncated) {
    throw new Error("Repository Audit inventory status/truncation truth is inconsistent.");
  }
  if (graphPartial !== analysis.graph.execution.truncated) {
    throw new Error("Repository Audit graph status/truncation truth is inconsistent.");
  }
  if (overallPartial !== analysis.execution.truncated) {
    throw new Error("Repository Audit analysis status/truncation truth is inconsistent.");
  }
  if (analysis.execution.truncated !== (analysis.inventory.execution.truncated || analysis.graph.execution.truncated)) {
    throw new Error("Repository Audit aggregate truncation truth does not match inventory/graph execution.");
  }

  const fileNodes = analysis.graph.graph.nodes.filter((node) => node.kind === "file").length;
  if (analysis.execution.secretFilesScanned !== fileNodes) {
    throw new Error("Repository Audit secret-scan scope does not match graph-accepted file evidence.");
  }
  if (analysis.execution.redactedSecretMatches !== analysis.secretWarnings.length) {
    throw new Error("Repository Audit redacted-secret count does not match emitted warnings.");
  }
}

export function createRepositoryAuditEvidenceCompleteness(
  analysis: RepositoryAuditAnalysisResult,
): RepositoryAuditEvidenceCompleteness {
  assertExecutionTruth(analysis);

  const inventoryReasons = uniqueSorted(analysis.execution.inventoryTruncationReasons);
  const graphReasons = uniqueSorted(analysis.execution.graphTruncationReasons);
  const fileNodes = analysis.graph.graph.nodes.filter((node) => node.kind === "file").length;
  const limitations: RepositoryAuditEvidenceLimitation[] = [
    ...inventoryReasons.map((reason) => ({
      scope: "inventory" as const,
      reason,
      message: limitationMessage(reason),
    })),
    ...graphReasons.map((reason) => ({
      scope: "graph" as const,
      reason,
      message: limitationMessage(reason),
    })),
  ];

  return {
    schema: "solvelang.repository-audit.evidence-completeness.v0",
    mode: "analyze-only",
    status: analysis.execution.status,
    truncated: analysis.execution.truncated,
    source: {
      fingerprint: analysis.source.fingerprint,
      revision: analysis.source.revision,
    },
    inventory: {
      status: analysis.inventory.execution.status,
      truncated: analysis.inventory.execution.truncated,
      truncationReasons: inventoryReasons,
      filesSeen: analysis.inventory.summary.filesSeen,
      filesScanned: analysis.inventory.summary.filesScanned,
      filesSkipped: analysis.inventory.summary.filesSkipped,
      bytesScanned: analysis.inventory.summary.bytesScanned,
    },
    graph: {
      status: analysis.graph.execution.status,
      truncated: analysis.graph.execution.truncated,
      truncationReasons: graphReasons,
      fileNodes,
      nodes: analysis.graph.graph.nodes.length,
      edges: analysis.graph.graph.edges.length,
      extractors: analysis.graph.graph.extractors
        .map(({ id, version }) => ({ id, version }))
        .sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version)),
    },
    secretAnalysis: {
      scope: "graph-accepted-files-only",
      filesScanned: analysis.execution.secretFilesScanned,
      redactedMatches: analysis.execution.redactedSecretMatches,
    },
    limitations,
    safety: {
      networkAccess: false,
      writeAccess: false,
    },
  };
}
