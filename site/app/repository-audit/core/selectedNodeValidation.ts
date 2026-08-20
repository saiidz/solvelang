import type { SolveGraphQueryIndex } from "../../solve-graph/core/query-impact";
import {
  createRepositoryAffectedValidationMap,
  type RepositoryAffectedValidationMap,
  type RepositoryAffectedValidationOptions,
} from "./affectedValidation";
import { normalizeRepositoryPath } from "./inventory";
import type { RepositoryWorkflowPathEvidenceAnalysis } from "./workflowPathEvidence";

export type RepositorySelectedNodeValidationOptions = Omit<
  RepositoryAffectedValidationOptions,
  "maxChangedPaths"
>;

function selectedNodePath(index: SolveGraphQueryIndex, selectedNodeId: string): string | undefined {
  const node = index.nodesById.get(selectedNodeId);
  if (!node) return undefined;

  const metadataPath = node.metadata?.path;
  if (typeof metadataPath === "string" && metadataPath.length > 0) {
    return normalizeRepositoryPath(metadataPath);
  }

  const evidencePath = node.evidence[0]?.path;
  return evidencePath ? normalizeRepositoryPath(evidencePath) : undefined;
}

export async function createRepositorySelectedNodeValidationMap(
  index: SolveGraphQueryIndex,
  workflowEvidence: RepositoryWorkflowPathEvidenceAnalysis,
  selectedNodeId: string | undefined,
  options: RepositorySelectedNodeValidationOptions = {},
): Promise<RepositoryAffectedValidationMap | undefined> {
  if (!selectedNodeId) return undefined;
  if (workflowEvidence.graphId !== index.document.graphId) {
    throw new Error("Repository Audit selected-node workflow evidence must match the impact graph.");
  }

  const changedPath = selectedNodePath(index, selectedNodeId);
  if (!changedPath) return undefined;

  return createRepositoryAffectedValidationMap(
    index.document,
    workflowEvidence,
    [changedPath],
    {
      ...options,
      maxChangedPaths: 1,
    },
  );
}
