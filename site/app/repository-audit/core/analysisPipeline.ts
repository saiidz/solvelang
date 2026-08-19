import {
  createRepositoryAffectedValidationMap,
  type RepositoryAffectedValidationMap,
  type RepositoryAffectedValidationOptions,
} from "./affectedValidation";
import {
  createRepositoryConfigurationReferenceAnalysis,
  type RepositoryConfigurationReferenceAnalysis,
  type RepositoryConfigurationReferenceOptions,
} from "./configurationReferences";
import {
  createRepositoryCoverageMap,
  type RepositoryCoverageMap,
  type RepositoryCoverageMapOptions,
} from "./coverageMapping";
import {
  createRepositoryDeadCodeCandidateAnalysis,
  type RepositoryDeadCodeCandidateAnalysis,
  type RepositoryDeadCodeCandidateOptions,
} from "./deadCodeCandidates";
import {
  analyzeRepositoryDependencyConsistency,
  type RepositoryDependencyConsistency,
  type RepositoryDependencyConsistencyOptions,
} from "./dependencyConsistency";
import {
  analyzeRepositoryGraph,
  type RepositoryAuditGraphPipelineOptions,
  type RepositoryAuditGraphPipelineResult,
} from "./graphPipeline";
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
import {
  createRepositoryWorkflowPathEvidence,
  type RepositoryWorkflowPathEvidenceAnalysis,
  type RepositoryWorkflowPathEvidenceOptions,
} from "./workflowPathEvidence";

export type RepositoryAffectedValidationRequest = RepositoryAffectedValidationOptions & {
  changedPaths: readonly string[];
};

export type RepositoryAuditAnalysisOptions = {
  inventoryLimits?: Partial<RepositoryScanLimits>;
  graph?: RepositoryAuditGraphPipelineOptions;
  dependencyConsistency?: RepositoryDependencyConsistencyOptions;
  coverageMap?: RepositoryCoverageMapOptions;
  deadCodeCandidates?: RepositoryDeadCodeCandidateOptions;
  configurationReferences?: RepositoryConfigurationReferenceOptions;
  workflowPathEvidence?: RepositoryWorkflowPathEvidenceOptions;
  affectedValidation?: RepositoryAffectedValidationRequest;
  secretHmacKey?: Uint8Array;
};

export type RepositoryAuditAnalysisResult = {
  schema: "solvelang.repository-audit.analysis.v0";
  mode: "analyze-only";
  source: RepositorySnapshot["source"];
  inventory: RepositoryInventoryAnalysis;
  graph: RepositoryAuditGraphPipelineResult;
  dependencyConsistency: RepositoryDependencyConsistency;
  coverageMap: RepositoryCoverageMap;
  deadCodeCandidates: RepositoryDeadCodeCandidateAnalysis;
  configurationReferences: RepositoryConfigurationReferenceAnalysis;
  workflowPathEvidence: RepositoryWorkflowPathEvidenceAnalysis;
  affectedValidation?: RepositoryAffectedValidationMap;
  secretWarnings: RepositorySecretWarning[];
  execution: {
    status: "complete" | "partial";
    truncated: boolean;
    inventoryTruncationReasons: RepositoryInventoryAnalysis["execution"]["truncationReasons"];
    graphTruncationReasons: RepositoryAuditGraphPipelineResult["execution"]["truncationReasons"];
    dependencyConsistencyStatus: RepositoryDependencyConsistency["execution"]["status"];
    coverageMapStatus: RepositoryCoverageMap["execution"]["status"];
    deadCodeCandidateStatus: RepositoryDeadCodeCandidateAnalysis["status"];
    configurationReferenceStatus: RepositoryConfigurationReferenceAnalysis["status"];
    workflowPathEvidenceStatus: RepositoryWorkflowPathEvidenceAnalysis["status"];
    affectedValidationStatus?: RepositoryAffectedValidationMap["status"];
    dependencyFilesScanned: number;
    undeclaredDependencyFindings: number;
    directTestMappings: number;
    documentationMappings: number;
    deadCodeCandidateCount: number;
    configurationReferenceCount: number;
    workflowPathReferenceCount: number;
    affectedTestFiles?: number;
    affectedWorkflowFiles?: number;
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
  const coverageMap = createRepositoryCoverageMap(snapshot, graph.graph, options.coverageMap);
  const deadCodeCandidates = await createRepositoryDeadCodeCandidateAnalysis(graph.graph, options.deadCodeCandidates);
  const configurationReferences = await createRepositoryConfigurationReferenceAnalysis(
    snapshot,
    graph.graph,
    options.configurationReferences,
  );
  const workflowPathEvidence = await createRepositoryWorkflowPathEvidence(
    snapshot,
    graph.graph,
    options.workflowPathEvidence,
  );
  const affectedValidation = options.affectedValidation
    ? await createRepositoryAffectedValidationMap(
      graph.graph,
      workflowPathEvidence,
      options.affectedValidation.changedPaths,
      options.affectedValidation,
    )
    : undefined;

  // Secret matching is restricted to files accepted by the bounded graph scan.
  // This prevents a secondary scanner from silently bypassing file/byte/depth limits.
  const secretSnapshot = graphAcceptedSecretSnapshot(snapshot, graph);
  const secretWarnings = await scanRepositorySecrets(
    secretSnapshot,
    options.secretHmacKey ? { hmacKey: options.secretHmacKey } : {},
  );

  const affectedValidationTruncated = affectedValidation !== undefined && (
    affectedValidation.execution.changedPathsTruncated
    || affectedValidation.execution.mappingsTruncated
  );
  const truncated = inventory.execution.truncated
    || graph.execution.truncated
    || dependencyConsistency.execution.findingsTruncated
    || coverageMap.execution.mappingsTruncated
    || coverageMap.execution.samplesTruncated
    || deadCodeCandidates.execution.candidatesTruncated
    || configurationReferences.execution.referencesTruncated
    || workflowPathEvidence.execution.referencesTruncated
    || affectedValidationTruncated;
  const partial = truncated
    || dependencyConsistency.execution.status === "partial"
    || coverageMap.execution.status === "partial"
    || deadCodeCandidates.status !== "complete"
    || configurationReferences.status === "partial"
    || workflowPathEvidence.status === "partial"
    || affectedValidation?.status === "partial";
  return {
    schema: "solvelang.repository-audit.analysis.v0",
    mode: "analyze-only",
    source: { ...snapshot.source },
    inventory,
    graph,
    dependencyConsistency,
    coverageMap,
    deadCodeCandidates,
    configurationReferences,
    workflowPathEvidence,
    ...(affectedValidation === undefined ? {} : { affectedValidation }),
    secretWarnings,
    execution: {
      status: partial ? "partial" : "complete",
      truncated,
      inventoryTruncationReasons: [...inventory.execution.truncationReasons],
      graphTruncationReasons: [...graph.execution.truncationReasons],
      dependencyConsistencyStatus: dependencyConsistency.execution.status,
      coverageMapStatus: coverageMap.execution.status,
      deadCodeCandidateStatus: deadCodeCandidates.status,
      configurationReferenceStatus: configurationReferences.status,
      workflowPathEvidenceStatus: workflowPathEvidence.status,
      ...(affectedValidation === undefined ? {} : {
        affectedValidationStatus: affectedValidation.status,
      }),
      dependencyFilesScanned: dependencyConsistency.execution.filesScanned,
      undeclaredDependencyFindings: dependencyConsistency.undeclaredImports.length,
      directTestMappings: coverageMap.testMappings.length,
      documentationMappings: coverageMap.documentationMappings.length,
      deadCodeCandidateCount: deadCodeCandidates.candidates.length,
      configurationReferenceCount: configurationReferences.references.length,
      workflowPathReferenceCount: workflowPathEvidence.references.length,
      ...(affectedValidation === undefined ? {} : {
        affectedTestFiles: affectedValidation.summary.affectedTestFiles,
        affectedWorkflowFiles: affectedValidation.summary.affectedWorkflowFiles,
      }),
      secretFilesScanned: secretSnapshot.files.length,
      redactedSecretMatches: secretWarnings.length,
      networkAccess: false,
      writeAccess: false,
    },
  };
}
