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
import type { DockerComposeRelationshipSnapshotEvidence } from "./dockerComposeRelationshipSnapshotEvidence";
import {
  createDockerComposeRelationshipSnapshotPresentation,
  type DockerComposeRelationshipSnapshotPresentation,
  type DockerComposeRelationshipSnapshotPresentationOptions,
} from "./dockerComposeRelationshipSnapshotPresentation";
import type { DockerComposeSnapshotEvidence } from "./dockerComposeSnapshotEvidence";
import {
  createDockerComposeSnapshotPresentation,
  type DockerComposeSnapshotPresentation,
  type DockerComposeSnapshotPresentationOptions,
} from "./dockerComposeSnapshotPresentation";
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
  dockerCompose?: DockerComposeSnapshotPresentationOptions;
  dockerComposeRelationships?: DockerComposeRelationshipSnapshotPresentationOptions;
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
  dockerCompose?: DockerComposeSnapshotPresentation;
  dockerComposeRelationships?: DockerComposeRelationshipSnapshotPresentation;
  frameworkPaths?: RepositoryFrameworkPathPresentation;
  packageScriptPaths?: RepositoryPackageScriptPathPresentation;
  visualExplorer: RepositoryAuditVisualExplorer;
  execution: {
    networkAccess: false;
    writeAccess: false;
    angularTargetConfigPartial?: boolean;
    deploymentPathPartial: boolean;
    dockerComposePartial?: boolean;
    dockerComposeRelationshipPartial?: boolean;
    frameworkPathPartial?: boolean;
    packageScriptPathPartial?: boolean;
    visualExplorerPartial: boolean;
  };
};

type RepositorySnapshotIdentityEvidence = {
  source: {
    fingerprint: string;
    revision: string;
  };
};

function sameSnapshotIdentity(
  graph: SolveGraphDocument,
  evidence: RepositorySnapshotIdentityEvidence,
): boolean {
  return graph.source.fingerprint === evidence.source.fingerprint
    && graph.source.revision === evidence.source.revision;
}

export async function createRepositoryAuditBrowserIntelligence(
  graph: SolveGraphDocument,
  deploymentPathEvidence: RepositoryDeploymentPathEvidenceAnalysis,
  options: RepositoryAuditBrowserIntelligenceOptions = {},
  frameworkPathEvidence?: RepositoryFrameworkPathEvidenceAnalysis,
  angularTargetConfigEvidence?: RepositoryAngularTargetConfigEvidenceAnalysis,
  packageScriptPathEvidence?: RepositoryPackageScriptPathEvidenceAnalysis,
  dockerComposeEvidence?: DockerComposeSnapshotEvidence,
  dockerComposeRelationshipEvidence?: DockerComposeRelationshipSnapshotEvidence,
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
  if (dockerComposeEvidence && !sameSnapshotIdentity(graph, dockerComposeEvidence)) {
    throw new Error("Repository Audit browser intelligence requires Docker Compose evidence from the same repository snapshot.");
  }
  if (dockerComposeRelationshipEvidence && !sameSnapshotIdentity(graph, dockerComposeRelationshipEvidence)) {
    throw new Error("Repository Audit browser intelligence requires Docker Compose relationship evidence from the same repository snapshot.");
  }

  const visualExplorer = await createRepositoryAuditVisualExplorer(graph, options.visualExplorer);
  const deploymentPaths = createRepositoryDeploymentPathPresentation(
    deploymentPathEvidence,
    options.deploymentPaths,
  );
  const dockerCompose = dockerComposeEvidence
    ? createDockerComposeSnapshotPresentation(dockerComposeEvidence, options.dockerCompose)
    : undefined;
  const dockerComposeRelationships = dockerComposeRelationshipEvidence
    ? createDockerComposeRelationshipSnapshotPresentation(
      dockerComposeRelationshipEvidence,
      options.dockerComposeRelationships,
    )
    : undefined;
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
  const dockerComposePartial = dockerCompose !== undefined && (
    dockerCompose.status === "partial"
    || dockerCompose.execution.rowsTruncated
  );
  const dockerComposeRelationshipPartial = dockerComposeRelationships !== undefined && (
    dockerComposeRelationships.status === "partial"
    || dockerComposeRelationships.execution.rowsTruncated
  );
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
      || dockerComposePartial
      || dockerComposeRelationshipPartial
      || frameworkPathPartial
      || packageScriptPathPartial
      || visualExplorerPartial
      ? "partial"
      : "complete",
    ...(angularTargetConfigs === undefined ? {} : { angularTargetConfigs }),
    deploymentPaths,
    ...(dockerCompose === undefined ? {} : { dockerCompose }),
    ...(dockerComposeRelationships === undefined ? {} : { dockerComposeRelationships }),
    ...(frameworkPaths === undefined ? {} : { frameworkPaths }),
    ...(packageScriptPaths === undefined ? {} : { packageScriptPaths }),
    visualExplorer,
    execution: {
      networkAccess: false,
      writeAccess: false,
      ...(angularTargetConfigs === undefined ? {} : { angularTargetConfigPartial }),
      deploymentPathPartial,
      ...(dockerCompose === undefined ? {} : { dockerComposePartial }),
      ...(dockerComposeRelationships === undefined ? {} : { dockerComposeRelationshipPartial }),
      ...(frameworkPaths === undefined ? {} : { frameworkPathPartial }),
      ...(packageScriptPaths === undefined ? {} : { packageScriptPathPartial }),
      visualExplorerPartial,
    },
  };
}
