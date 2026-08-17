import {
  analyzeRepositoryGraph,
  type RepositoryAuditGraphPipelineOptions,
  type RepositoryAuditGraphPipelineResult,
} from "./graphPipeline";
import {
  analyzeRepositoryInventory,
  type RepositoryInventoryAnalysis,
  type RepositoryScanLimits,
  type RepositorySnapshot,
} from "./inventory";
import {
  scanRepositorySecrets,
  type RepositorySecretWarning,
} from "./secretScan";

export type RepositoryAuditAnalysisOptions = {
  inventoryLimits?: Partial<RepositoryScanLimits>;
  graph?: RepositoryAuditGraphPipelineOptions;
  secretHmacKey?: Uint8Array;
};

export type RepositoryAuditAnalysisResult = {
  schema: "solvelang.repository-audit.analysis.v0";
  mode: "analyze-only";
  source: RepositorySnapshot["source"];
  inventory: RepositoryInventoryAnalysis;
  graph: RepositoryAuditGraphPipelineResult;
  secretWarnings: RepositorySecretWarning[];
  execution: {
    status: "complete" | "partial";
    truncated: boolean;
    inventoryTruncationReasons: RepositoryInventoryAnalysis["execution"]["truncationReasons"];
    graphTruncationReasons: RepositoryAuditGraphPipelineResult["execution"]["truncationReasons"];
    redactedSecretMatches: number;
    networkAccess: false;
    writeAccess: false;
  };
};

function sameSource(
  expected: RepositorySnapshot["source"],
  actual: RepositorySnapshot["source"],
): boolean {
  return expected.kind === actual.kind
    && expected.displayName === actual.displayName
    && expected.revision === actual.revision
    && expected.fingerprint === actual.fingerprint;
}

export async function analyzeRepositorySnapshot(
  snapshot: RepositorySnapshot,
  options: RepositoryAuditAnalysisOptions = {},
): Promise<RepositoryAuditAnalysisResult> {
  // Inventory validation runs first so malformed/unsafe snapshot paths fail closed
  // before any secondary analysis is attempted.
  const inventory = analyzeRepositoryInventory(snapshot, options.inventoryLimits);
  if (!sameSource(snapshot.source, inventory.source)) {
    throw new Error("Repository Audit inventory source does not match the analyzed snapshot.");
  }

  const graph = await analyzeRepositoryGraph(snapshot, options.graph);
  if (!sameSource(snapshot.source, {
    kind: snapshot.source.kind,
    displayName: graph.graph.source.displayName,
    revision: graph.graph.source.revision,
    fingerprint: graph.graph.source.fingerprint,
  })) {
    throw new Error("Repository Audit graph source does not match the analyzed snapshot.");
  }

  const secretWarnings = await scanRepositorySecrets(
    snapshot,
    options.secretHmacKey ? { hmacKey: options.secretHmacKey } : {},
  );

  const truncated = inventory.execution.truncated || graph.execution.truncated;
  return {
    schema: "solvelang.repository-audit.analysis.v0",
    mode: "analyze-only",
    source: { ...snapshot.source },
    inventory,
    graph,
    secretWarnings,
    execution: {
      status: truncated ? "partial" : "complete",
      truncated,
      inventoryTruncationReasons: [...inventory.execution.truncationReasons],
      graphTruncationReasons: [...graph.execution.truncationReasons],
      redactedSecretMatches: secretWarnings.length,
      networkAccess: false,
      writeAccess: false,
    },
  };
}
