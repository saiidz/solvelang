import type { SolveGraphDocument } from "../../solve-graph/core/contracts";
import type { RepositoryAngularTargetConfigEvidenceAnalysis } from "./angularTargetConfigEvidence";
import {
  createRepositoryAngularTargetConfigPresentation,
  type RepositoryAngularTargetConfigPresentation,
  type RepositoryAngularTargetConfigPresentationOptions,
} from "./angularTargetConfigPresentation";
import type { RepositoryDeploymentPathEvidenceAnalysis } from "./deploymentPathEvidence";
import {
  createRepositoryDeploymentPathPresentation,
  type RepositoryDeploymentPathPresentation,
  type RepositoryDeploymentPathPresentationOptions,
} from "./deploymentPathPresentation";
import type { RepositoryFrameworkPathEvidenceAnalysis } from "./frameworkPathEvidence";
import {
  createRepositoryFrameworkPathPresentation,
  type RepositoryFrameworkPathPresentation,
  type RepositoryFrameworkPathPresentationOptions,
} from "./frameworkPathPresentation";
import type { RepositoryPackageScriptPathEvidenceAnalysis } from "./packageScriptPathEvidence";
import {
  createRepositoryPackageScriptPathPresentation,
  type RepositoryPackageScriptPathPresentation,
  type RepositoryPackageScriptPathPresentationOptions,
} from "./packageScriptPathPresentation";
import {
  createRepositoryAuditVisualExplorer,
  type RepositoryAuditVisualExplorer,
  type RepositoryAuditVisualExplorerOptions,
} from "./visualExplorer";

export type RepositoryAuditBrowserIntelligenceOptions = {
  angularTargetConfigs?: RepositoryAngularTargetConfigPresentationOptions;
  deploymentPaths?: RepositoryDeploymentPathPresentationOptions;
  frameworkPaths?: RepositoryFrameworkPathPresentationOptions;
  packageScriptPaths?: RepositoryPackageScriptPathPresentationOptions;
  visualExplorer?: RepositoryAuditVisualExplorerOptions;
};

export type RepositoryAuditBrowserIntelligence = {
  schema: "solvelang.repository-audit.browser-intelligence.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  angularTargetConfigs?: RepositoryAngularTargetConfigPresentation;
  deploymentPaths: RepositoryDeploymentPathPresentation;
  frameworkPaths?: RepositoryFrameworkPathPresentation;
  packageScriptPaths?: RepositoryPackageScriptPathPresentation;
  visualExplorer: RepositoryAuditVisualExplorer;
  execution: {
    networkAccess: false;
    writeAccess: false;
    angularTargetConfigPartial?: boolean;
    deploymentPathPartial: boolean;
    frameworkPathPartial?: boolean;
    packageScriptPathPartial?: boolean;
    visualExplorerPartial: boolean;
  };
};

export async function createRepositoryAuditBrowserIntelligence(
  graph: SolveGraphDocument,
  deploymentPathEvidence: RepositoryDeploymentPathEvidenceAnalysis,
  options: RepositoryAuditBrowserIntelligenceOptions = {},
  frameworkPathEvidence?: RepositoryFrameworkPathEvidenceAnalysis,
  angularTargetConfigEvidence?: RepositoryAngularTargetConfigEvidenceAnalysis,
  packageScriptPathEvidence?: RepositoryPackageScriptPathEvidenceAnalysis,
): Promise<RepositoryAuditBrowserIntelligence> {
  if (graph.graphId !== deploymentPathEvidence.graphId) {
    throw new Error("Repository Audit browser intelligence requires deployment evidence from the same Solve Graph document.");
  }
  if (frameworkPathEvidence && graph.graphId !== frameworkPathEvidence.graphId) {
    throw new Error("Repository Audit browser intelligence requires framework evidence from the same Solve Graph document.");
  }
  if (angularTargetConfigEvidence && graph.graphId !== angularTargetConfigEvidence.graphId) {
    throw new Error("Repository Audit browser intelligence requires Angular target-config evidence from the same Solve Graph document.");
  }
  if (packageScriptPathEvidence && graph.graphId !== packageScriptPathEvidence.graphId) {
    throw new Error("Repository Audit browser intelligence requires package-script path evidence from the same Solve Graph document.");
  }

  const visualExplorer = await createRepositoryAuditVisualExplorer(graph, options.visualExplorer);
  const deploymentPaths = createRepositoryDeploymentPathPresentation(
    deploymentPathEvidence,
    options.deploymentPaths,
  );
  const frameworkPaths = frameworkPathEvidence
    ? createRepositoryFrameworkPathPresentation(frameworkPathEvidence, options.frameworkPaths)
    : undefined;
  const angularTargetConfigs = angularTargetConfigEvidence
    ? createRepositoryAngularTargetConfigPresentation(angularTargetConfigEvidence, options.angularTargetConfigs)
    : undefined;
  const packageScriptPaths = packageScriptPathEvidence
    ? createRepositoryPackageScriptPathPresentation(packageScriptPathEvidence, options.packageScriptPaths)
    : undefined;

  if (visualExplorer.graphId !== deploymentPaths.graphId
    || (frameworkPaths && frameworkPaths.graphId !== deploymentPaths.graphId)
    || (angularTargetConfigs && angularTargetConfigs.graphId !== deploymentPaths.graphId)
    || (packageScriptPaths && packageScriptPaths.graphId !== deploymentPaths.graphId)) {
    throw new Error("Repository Audit browser intelligence graph identity changed during composition.");
  }

  const angularTargetConfigPartial = angularTargetConfigs !== undefined && (
    angularTargetConfigs.status === "partial"
    || angularTargetConfigs.execution.rowsTruncated
  );
  const deploymentPathPartial = deploymentPaths.status === "partial"
    || deploymentPaths.execution.rowsTruncated;
  const frameworkPathPartial = frameworkPaths !== undefined && (
    frameworkPaths.status === "partial"
    || frameworkPaths.execution.rowsTruncated
  );
  const packageScriptPathPartial = packageScriptPaths !== undefined && (
    packageScriptPaths.status === "partial"
    || packageScriptPaths.execution.rowsTruncated
  );
  const visualExplorerPartial = visualExplorer.status === "partial";

  return {
    schema: "solvelang.repository-audit.browser-intelligence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: angularTargetConfigPartial
      || deploymentPathPartial
      || frameworkPathPartial
      || packageScriptPathPartial
      || visualExplorerPartial
      ? "partial"
      : "complete",
    ...(angularTargetConfigs === undefined ? {} : { angularTargetConfigs }),
    deploymentPaths,
    ...(frameworkPaths === undefined ? {} : { frameworkPaths }),
    ...(packageScriptPaths === undefined ? {} : { packageScriptPaths }),
    visualExplorer,
    execution: {
      networkAccess: false,
      writeAccess: false,
      ...(angularTargetConfigs === undefined ? {} : { angularTargetConfigPartial }),
      deploymentPathPartial,
      ...(frameworkPaths === undefined ? {} : { frameworkPathPartial }),
      ...(packageScriptPaths === undefined ? {} : { packageScriptPathPartial }),
      visualExplorerPartial,
    },
  };
}
