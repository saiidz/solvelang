import type { SolveGraphImpactQueryProduct } from "../../solve-graph/core/impact-query-product";
import type { SolveGraphQueryIndex } from "../../solve-graph/core/query-impact";
import type { RepositoryAffectedValidationMap } from "./affectedValidation";
import {
  createRepositoryAuditSelectedNodeImpactProduct,
  type RepositoryAuditSelectedNodeImpactOptions,
} from "./selectedNodeImpact";
import {
  createRepositorySelectedNodeValidationMap,
  type RepositorySelectedNodeValidationOptions,
} from "./selectedNodeValidation";
import type { RepositoryAuditVisualExplorer } from "./visualExplorer";
import type { RepositoryWorkflowPathEvidenceAnalysis } from "./workflowPathEvidence";

export type RepositorySelectedNodeIntelligenceOptions = {
  impact?: RepositoryAuditSelectedNodeImpactOptions;
  validation?: RepositorySelectedNodeValidationOptions;
};

export type RepositorySelectedNodeIntelligence = {
  schema: "solvelang.repository-audit.selected-node-intelligence.v0";
  mode: "analyze-only";
  graphId: string;
  selectedNodeId: string;
  impact: SolveGraphImpactQueryProduct;
  validation?: RepositoryAffectedValidationMap;
  status: "complete" | "partial";
  execution: {
    networkAccess: false;
    writeAccess: false;
    impactQueryTruncated: boolean;
    impactPresentationTruncated: boolean;
    validationAvailable: boolean;
    validationPartial: boolean;
  };
};

export async function createRepositorySelectedNodeIntelligence(
  explorer: RepositoryAuditVisualExplorer,
  index: SolveGraphQueryIndex,
  workflowEvidence: RepositoryWorkflowPathEvidenceAnalysis,
  selectedNodeId: string | undefined,
  options: RepositorySelectedNodeIntelligenceOptions = {},
): Promise<RepositorySelectedNodeIntelligence | undefined> {
  if (!selectedNodeId) return undefined;

  const impact = createRepositoryAuditSelectedNodeImpactProduct(
    explorer,
    index,
    selectedNodeId,
    options.impact,
  );
  if (!impact) return undefined;

  const validation = await createRepositorySelectedNodeValidationMap(
    index,
    workflowEvidence,
    selectedNodeId,
    options.validation,
  );

  if (impact.graphId !== explorer.graphId
    || impact.graphId !== index.document.graphId
    || impact.execution.networkAccess !== false
    || impact.execution.writeAccess !== false
    || (validation && (
      validation.graphId !== impact.graphId
      || validation.execution.networkAccess !== false
      || validation.execution.writeAccess !== false
    ))) {
    throw new Error("Repository Audit selected-node intelligence identity changed during composition.");
  }

  const validationPartial = validation?.status === "partial";
  const partial = impact.status === "partial" || validationPartial === true;

  return {
    schema: "solvelang.repository-audit.selected-node-intelligence.v0",
    mode: "analyze-only",
    graphId: impact.graphId,
    selectedNodeId,
    impact,
    ...(validation === undefined ? {} : { validation }),
    status: partial ? "partial" : "complete",
    execution: {
      networkAccess: false,
      writeAccess: false,
      impactQueryTruncated: impact.execution.queryTruncated,
      impactPresentationTruncated: impact.execution.presentationTruncated,
      validationAvailable: validation !== undefined,
      validationPartial: validationPartial === true,
    },
  };
}
