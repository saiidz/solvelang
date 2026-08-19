import {
  createRepositoryAffectedValidationMap,
  type RepositoryAffectedValidationMap,
  type RepositoryAffectedValidationOptions,
} from "./affectedValidation";
import {
  createRepositoryAngularTargetConfigEvidenceAnalysis,
  type RepositoryAngularTargetConfigEvidenceAnalysis,
  type RepositoryAngularTargetConfigEvidenceOptions,
} from "./angularTargetConfigEvidence";
import {
  analyzeRepositoryArchitecturePaths,
  type RepositoryArchitecturePathAnalysis,
  type RepositoryArchitecturePathOptions,
} from "./architecturePaths";
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
  createRepositoryDeploymentPathEvidenceAnalysis,
  type RepositoryDeploymentPathEvidenceAnalysis,
  type RepositoryDeploymentPathEvidenceOptions,
} from "./deploymentPathEvidence";
import {
  createRepositoryFrameworkPathEvidenceAnalysis,
  type RepositoryFrameworkPathEvidenceAnalysis,
  type RepositoryFrameworkPathEvidenceOptions,
} from "./frameworkPathEvidence";
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
  createRepositoryPackageScriptPathEvidenceAnalysis,
  type RepositoryPackageScriptPathEvidenceAnalysis,
  type RepositoryPackageScriptPathEvidenceOptions,
} from "./packageScriptPathEvidence";
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
  architecturePaths?: RepositoryArchitecturePathOptions;
  dependencyConsistency?: RepositoryDependencyConsistencyOptions;
  coverageMap?: RepositoryCoverageMapOptions;
  deadCodeCandidates?: RepositoryDeadCodeCandidateOptions;
  configurationReferences?: RepositoryConfigurationReferenceOptions;
  workflowPathEvidence?: RepositoryWorkflowPathEvidenceOptions;
  deploymentPathEvidence?: RepositoryDeploymentPathEvidenceOptions;
  frameworkPathEvidence?: RepositoryFrameworkPathEvidenceOptions;
  angularTargetConfigEvidence?: RepositoryAngularTargetConfigEvidenceOptions;
  packageScriptPathEvidence?: RepositoryPackageScriptPathEvidenceOptions;
  affectedValidation?: RepositoryAffectedValidationRequest;
  secretHmacKey?: Uint8Array;
};

export type RepositoryAuditAnalysisResult = {
  schema: "solvelang.repository-audit.analysis.v0";
  mode: "analyze-only";
  source: RepositorySnapshot["source"];
  inventory: RepositoryInventoryAnalysis;
  graph: RepositoryAuditGraphPipelineResult;
  architecturePaths: RepositoryArchitecturePathAnalysis;
  dependencyConsistency: RepositoryDependencyConsistency;
  coverageMap: RepositoryCoverageMap;
  deadCodeCandidates: RepositoryDeadCodeCandidateAnalysis;
  configurationReferences: RepositoryConfigurationReferenceAnalysis;
  workflowPathEvidence: RepositoryWorkflowPathEvidenceAnalysis;
  deploymentPathEvidence: RepositoryDeploymentPathEvidenceAnalysis;
  frameworkPathEvidence: RepositoryFrameworkPathEvidenceAnalysis;
  angularTargetConfigEvidence: RepositoryAngularTargetConfigEvidenceAnalysis;
  packageScriptPathEvidence: RepositoryPackageScriptPathEvidenceAnalysis;
  affectedValidation?: RepositoryAffectedValidationMap;
  secretWarnings: RepositorySecretWarning[];
  execution: {
    status: "complete" | "partial";
    truncated: boolean;
    inventoryTruncationReasons: RepositoryInventoryAnalysis["execution"]["truncationReasons"];
    graphTruncationReasons: RepositoryAuditGraphPipelineResult["execution"]["truncationReasons"];
    architecturePathStatus: RepositoryArchitecturePathAnalysis["status"];
    dependencyConsistencyStatus: RepositoryDependencyConsistency["execution"]["status"];
    coverageMapStatus: RepositoryCoverageMap["execution"]["status"];
    deadCodeCandidateStatus: RepositoryDeadCodeCandidateAnalysis["status"];
    configurationReferenceStatus: RepositoryConfigurationReferenceAnalysis["status"];
    workflowPathEvidenceStatus: RepositoryWorkflowPathEvidenceAnalysis["status"];
    deploymentPathEvidenceStatus: RepositoryDeploymentPathEvidenceAnalysis["status"];
    frameworkPathEvidenceStatus: RepositoryFrameworkPathEvidenceAnalysis["status"];
    angularTargetConfigEvidenceStatus: RepositoryAngularTargetConfigEvidenceAnalysis["status"];
    packageScriptPathEvidenceStatus: RepositoryPackageScriptPathEvidenceAnalysis["status"];
    affectedValidationStatus?: RepositoryAffectedValidationMap["status"];
    architecturePathCount: number;
    securityBoundaryPathCount: number;
    dependencyFilesScanned: number;
    undeclaredDependencyFindings: number;
    directTestMappings: number;
    documentationMappings: number;
    deadCodeCandidateCount: number;
    configurationReferenceCount: number;
    workflowPathReferenceCount: number;
    deploymentPathReferenceCount: number;
    frameworkPathReferenceCount: number;
    angularTargetConfigReferenceCount: number;
    packageScriptPathReferenceCount: number;
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

  const architecturePaths = await analyzeRepositoryArchitecturePaths(graph.graph, options.architecturePaths);
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
  const deploymentPathEvidence = await createRepositoryDeploymentPathEvidenceAnalysis(
    snapshot,
    graph.graph,
    options.deploymentPathEvidence,
  );
  const frameworkPathEvidence = await createRepositoryFrameworkPathEvidenceAnalysis(
    snapshot,
    graph.graph,
    options.frameworkPathEvidence,
  );
  const angularTargetConfigEvidence = await createRepositoryAngularTargetConfigEvidenceAnalysis(
    snapshot,
    graph.graph,
    options.angularTargetConfigEvidence,
  );
  const packageScriptPathEvidence = await createRepositoryPackageScriptPathEvidenceAnalysis(
    snapshot,
    graph.graph,
    options.packageScriptPathEvidence,
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

  const architecturePathsTruncated = architecturePaths.execution.rootsTruncated
    || architecturePaths.execution.traversalTruncated
    || architecturePaths.execution.pathsTruncated;
  const affectedValidationTruncated = affectedValidation !== undefined && (
    affectedValidation.execution.changedPathsTruncated
    || affectedValidation.execution.mappingsTruncated
  );
  const truncated = inventory.execution.truncated
    || graph.execution.truncated
    || architecturePathsTruncated
    || dependencyConsistency.execution.findingsTruncated
    || coverageMap.execution.mappingsTruncated
    || coverageMap.execution.samplesTruncated
    || deadCodeCandidates.execution.candidatesTruncated
    || configurationReferences.execution.referencesTruncated
    || workflowPathEvidence.execution.referencesTruncated
    || deploymentPathEvidence.execution.relationshipsTruncated
    || frameworkPathEvidence.execution.relationshipsTruncated
    || angularTargetConfigEvidence.execution.relationshipsTruncated
    || packageScriptPathEvidence.execution.relationshipsTruncated
    || affectedValidationTruncated;
  const partial = truncated
    || architecturePaths.status === "partial"
    || dependencyConsistency.execution.status === "partial"
    || coverageMap.execution.status === "partial"
    || deadCodeCandidates.status !== "complete"
    || configurationReferences.status === "partial"
    || workflowPathEvidence.status === "partial"
    || deploymentPathEvidence.status === "partial"
    || frameworkPathEvidence.status === "partial"
    || angularTargetConfigEvidence.status === "partial"
    || packageScriptPathEvidence.status === "partial"
    || affectedValidation?.status === "partial";
  return {
    schema: "solvelang.repository-audit.analysis.v0",
    mode: "analyze-only",
    source: { ...snapshot.source },
    inventory,
    graph,
    architecturePaths,
    dependencyConsistency,
    coverageMap,
    deadCodeCandidates,
    configurationReferences,
    workflowPathEvidence,
    deploymentPathEvidence,
    frameworkPathEvidence,
    angularTargetConfigEvidence,
    packageScriptPathEvidence,
    ...(affectedValidation === undefined ? {} : { affectedValidation }),
    secretWarnings,
    execution: {
      status: partial ? "partial" : "complete",
      truncated,
      inventoryTruncationReasons: [...inventory.execution.truncationReasons],
      graphTruncationReasons: [...graph.execution.truncationReasons],
      architecturePathStatus: architecturePaths.status,
      dependencyConsistencyStatus: dependencyConsistency.execution.status,
      coverageMapStatus: coverageMap.execution.status,
      deadCodeCandidateStatus: deadCodeCandidates.status,
      configurationReferenceStatus: configurationReferences.status,
      workflowPathEvidenceStatus: workflowPathEvidence.status,
      deploymentPathEvidenceStatus: deploymentPathEvidence.status,
      frameworkPathEvidenceStatus: frameworkPathEvidence.status,
      angularTargetConfigEvidenceStatus: angularTargetConfigEvidence.status,
      packageScriptPathEvidenceStatus: packageScriptPathEvidence.status,
      ...(affectedValidation === undefined ? {} : {
        affectedValidationStatus: affectedValidation.status,
      }),
      architecturePathCount: architecturePaths.paths.length,
      securityBoundaryPathCount: architecturePaths.summary.securityBoundaryPaths,
      dependencyFilesScanned: dependencyConsistency.execution.filesScanned,
      undeclaredDependencyFindings: dependencyConsistency.undeclaredImports.length,
      directTestMappings: coverageMap.testMappings.length,
      documentationMappings: coverageMap.documentationMappings.length,
      deadCodeCandidateCount: deadCodeCandidates.candidates.length,
      configurationReferenceCount: configurationReferences.references.length,
      workflowPathReferenceCount: workflowPathEvidence.references.length,
      deploymentPathReferenceCount: deploymentPathEvidence.relationships.length,
      frameworkPathReferenceCount: frameworkPathEvidence.relationships.length,
      angularTargetConfigReferenceCount: angularTargetConfigEvidence.relationships.length,
      packageScriptPathReferenceCount: packageScriptPathEvidence.relationships.length,
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
