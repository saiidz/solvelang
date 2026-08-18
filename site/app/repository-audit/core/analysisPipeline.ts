import {
  analyzeRepositoryGraph,
  type RepositoryAuditGraphPipelineOptions,
  type RepositoryAuditGraphPipelineResult,
} from "./graphPipeline";
import {
  analyzeRepositoryDependencyConsistency,
  type RepositoryDependencyConsistency,
  type RepositoryDependencyConsistencyOptions,
} from "./dependencyConsistency";
import {
  analyzeRepositoryInventory,
  normalizeRepositoryPath,
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
  dependencyConsistency?: RepositoryDependencyConsistencyOptions;
  secretHmacKey?: Uint8Array;
};

export type RepositoryAuditAnalysisResult = {
  schema: "solvelang.repository-audit.analysis.v0";
  mode: "analyze-only";
  source: RepositorySnapshot["source"];
  inventory: RepositoryInventoryAnalysis;
  graph: RepositoryAuditGraphPipelineResult;
  dependencyConsistency: RepositoryDependencyConsistency;
  secretWarnings: RepositorySecretWarning[];
  execution: {
    status: "complete" | "partial";
    truncated: boolean;
    inventoryTruncationReasons: RepositoryInventoryAnalysis["execution"]["truncationReasons"];
    graphTruncationReasons: RepositoryAuditGraphPipelineResult["execution"]["truncationReasons"];
    dependencyConsistencyStatus: RepositoryDependencyConsistency["execution"]["status"];
    dependencyFilesScanned: number;
    undeclaredDependencyFindings: number;
    secretFilesScanned: number;
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

function graphAcceptedSecretSnapshot(
  snapshot: RepositorySnapshot,
  graph: RepositoryAuditGraphPipelineResult,
): RepositorySnapshot {
  const filesByPath = new Map(snapshot.files.map((file) => {
    const path = normalizeRepositoryPath(file.path);
    return [path, { ...file, path }] as const;
  }));
  const acceptedPaths = graph.graph.nodes
    .filter((node) => node.kind === "file" && typeof node.metadata?.path === "string")
    .map((node) => node.metadata!.path as string);
  const files = acceptedPaths.map((path) => {
    const file = filesByPath.get(path);
    if (!file) throw new Error(`Repository Audit graph references an unavailable source file: ${path}`);
    return file;
  });
  return { source: { ...snapshot.source }, files };
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

  const dependencyConsistency = analyzeRepositoryDependencyConsistency(
    snapshot,
    graph.graph,
    options.dependencyConsistency,
  );

  // Secret matching is restricted to files accepted by the bounded graph scan.
  // This prevents a secondary scanner from silently bypassing file/byte/depth limits.
  const secretSnapshot = graphAcceptedSecretSnapshot(snapshot, graph);
  const secretWarnings = await scanRepositorySecrets(
    secretSnapshot,
    options.secretHmacKey ? { hmacKey: options.secretHmacKey } : {},
  );

  const truncated = inventory.execution.truncated
    || graph.execution.truncated
    || dependencyConsistency.execution.findingsTruncated;
  const partial = truncated || dependencyConsistency.execution.status === "partial";
  return {
    schema: "solvelang.repository-audit.analysis.v0",
    mode: "analyze-only",
    source: { ...snapshot.source },
    inventory,
    graph,
    dependencyConsistency,
    secretWarnings,
    execution: {
      status: partial ? "partial" : "complete",
      truncated,
      inventoryTruncationReasons: [...inventory.execution.truncationReasons],
      graphTruncationReasons: [...graph.execution.truncationReasons],
      dependencyConsistencyStatus: dependencyConsistency.execution.status,
      dependencyFilesScanned: dependencyConsistency.execution.filesScanned,
      undeclaredDependencyFindings: dependencyConsistency.undeclaredImports.length,
      secretFilesScanned: secretSnapshot.files.length,
      redactedSecretMatches: secretWarnings.length,
      networkAccess: false,
      writeAccess: false,
    },
  };
}
