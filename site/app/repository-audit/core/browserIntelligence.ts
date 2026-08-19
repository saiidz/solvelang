import type { SolveGraphDocument } from "../../solve-graph/core/contracts";
import type { RepositoryDeploymentPathEvidenceAnalysis } from "./deploymentPathEvidence";
import {
  createRepositoryDeploymentPathPresentation,
  type RepositoryDeploymentPathPresentation,
  type RepositoryDeploymentPathPresentationOptions,
} from "./deploymentPathPresentation";
import {
  createRepositoryAuditVisualExplorer,
  type RepositoryAuditVisualExplorer,
  type RepositoryAuditVisualExplorerOptions,
} from "./visualExplorer";

export type RepositoryAuditBrowserIntelligenceOptions = {
  deploymentPaths?: RepositoryDeploymentPathPresentationOptions;
  visualExplorer?: RepositoryAuditVisualExplorerOptions;
};

export type RepositoryAuditBrowserIntelligence = {
  schema: "solvelang.repository-audit.browser-intelligence.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  deploymentPaths: RepositoryDeploymentPathPresentation;
  visualExplorer: RepositoryAuditVisualExplorer;
  execution: {
    networkAccess: false;
    writeAccess: false;
    deploymentPathPartial: boolean;
    visualExplorerPartial: boolean;
  };
};

export async function createRepositoryAuditBrowserIntelligence(
  graph: SolveGraphDocument,
  deploymentPathEvidence: RepositoryDeploymentPathEvidenceAnalysis,
  options: RepositoryAuditBrowserIntelligenceOptions = {},
): Promise<RepositoryAuditBrowserIntelligence> {
  if (graph.graphId !== deploymentPathEvidence.graphId) {
    throw new Error("Repository Audit browser intelligence requires deployment evidence from the same Solve Graph document.");
  }

  const visualExplorer = await createRepositoryAuditVisualExplorer(graph, options.visualExplorer);
  const deploymentPaths = createRepositoryDeploymentPathPresentation(
    deploymentPathEvidence,
    options.deploymentPaths,
  );

  if (visualExplorer.graphId !== deploymentPaths.graphId) {
    throw new Error("Repository Audit browser intelligence graph identity changed during composition.");
  }

  const deploymentPathPartial = deploymentPaths.status === "partial";
  const visualExplorerPartial = visualExplorer.status === "partial";

  return {
    schema: "solvelang.repository-audit.browser-intelligence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: deploymentPathPartial || visualExplorerPartial ? "partial" : "complete",
    deploymentPaths,
    visualExplorer,
    execution: {
      networkAccess: false,
      writeAccess: false,
      deploymentPathPartial,
      visualExplorerPartial,
    },
  };
}
