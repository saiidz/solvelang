import type { SolveGraphDocument } from "../../solve-graph/core/contracts";
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
import {
  createRepositoryAuditVisualExplorer,
  type RepositoryAuditVisualExplorer,
  type RepositoryAuditVisualExplorerOptions,
} from "./visualExplorer";

export type RepositoryAuditBrowserIntelligenceOptions = {
  deploymentPaths?: RepositoryDeploymentPathPresentationOptions;
  frameworkPaths?: RepositoryFrameworkPathPresentationOptions;
  visualExplorer?: RepositoryAuditVisualExplorerOptions;
};

export type RepositoryAuditBrowserIntelligence = {
  schema: "solvelang.repository-audit.browser-intelligence.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  deploymentPaths: RepositoryDeploymentPathPresentation;
  frameworkPaths?: RepositoryFrameworkPathPresentation;
  visualExplorer: RepositoryAuditVisualExplorer;
  execution: {
    networkAccess: false;
    writeAccess: false;
    deploymentPathPartial: boolean;
    frameworkPathPartial?: boolean;
    visualExplorerPartial: boolean;
  };
};

export async function createRepositoryAuditBrowserIntelligence(
  graph: SolveGraphDocument,
  deploymentPathEvidence: RepositoryDeploymentPathEvidenceAnalysis,
  options: RepositoryAuditBrowserIntelligenceOptions = {},
  frameworkPathEvidence?: RepositoryFrameworkPathEvidenceAnalysis,
): Promise<RepositoryAuditBrowserIntelligence> {
  if (graph.graphId !== deploymentPathEvidence.graphId) {
    throw new Error("Repository Audit browser intelligence requires deployment evidence from the same Solve Graph document.");
  }
  if (frameworkPathEvidence && graph.graphId !== frameworkPathEvidence.graphId) {
    throw new Error("Repository Audit browser intelligence requires framework evidence from the same Solve Graph document.");
  }

  const visualExplorer = await createRepositoryAuditVisualExplorer(graph, options.visualExplorer);
  const deploymentPaths = createRepositoryDeploymentPathPresentation(
    deploymentPathEvidence,
    options.deploymentPaths,
  );
  const frameworkPaths = frameworkPathEvidence
    ? createRepositoryFrameworkPathPresentation(frameworkPathEvidence, options.frameworkPaths)
    : undefined;

  if (visualExplorer.graphId !== deploymentPaths.graphId
    || (frameworkPaths && frameworkPaths.graphId !== deploymentPaths.graphId)) {
    throw new Error("Repository Audit browser intelligence graph identity changed during composition.");
  }

  const deploymentPathPartial = deploymentPaths.status === "partial"
    || deploymentPaths.execution.rowsTruncated;
  const frameworkPathPartial = frameworkPaths !== undefined && (
    frameworkPaths.status === "partial"
    || frameworkPaths.execution.rowsTruncated
  );
  const visualExplorerPartial = visualExplorer.status === "partial";

  return {
    schema: "solvelang.repository-audit.browser-intelligence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: deploymentPathPartial || frameworkPathPartial || visualExplorerPartial ? "partial" : "complete",
    deploymentPaths,
    ...(frameworkPaths === undefined ? {} : { frameworkPaths }),
    visualExplorer,
    execution: {
      networkAccess: false,
      writeAccess: false,
      deploymentPathPartial,
      ...(frameworkPaths === undefined ? {} : { frameworkPathPartial }),
      visualExplorerPartial,
    },
  };
}
