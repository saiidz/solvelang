import type { RepositoryAuditVisualExplorer } from "./visualExplorer";
import type { RepositoryWorkflowPathEvidenceAnalysis } from "./workflowPathEvidence";

export type RepositorySelectedNodeIntelligenceRequestIdentity = {
  graphId: string;
  workflowGraphId: string;
  selectedNodeId: string;
  key: string;
};

function encodePart(value: string | number | boolean): string {
  const text = String(value);
  return `${text.length}:${text}`;
}

/**
 * Builds a deterministic identity for browser-local selected-node intelligence work.
 *
 * The workflow evidence is bounded before this function receives it, so including its
 * structural reference IDs and completeness counters keeps a completed result from an
 * earlier evidence snapshot from being treated as current when the graph/node is the
 * same but the workflow evidence changed.
 */
export function createRepositorySelectedNodeIntelligenceRequestIdentity(
  explorer: RepositoryAuditVisualExplorer,
  workflowEvidence: RepositoryWorkflowPathEvidenceAnalysis,
  selectedNodeId: string | undefined,
): RepositorySelectedNodeIntelligenceRequestIdentity | undefined {
  if (!selectedNodeId) return undefined;

  const referenceIds = workflowEvidence.references.map((reference) => reference.referenceId);
  const parts: Array<string | number | boolean> = [
    explorer.graphId,
    workflowEvidence.graphId,
    selectedNodeId,
    workflowEvidence.status,
    workflowEvidence.execution.referencesTruncated,
    workflowEvidence.execution.graphTruncated,
    workflowEvidence.skipped.missingText,
    workflowEvidence.skipped.oversizedText,
    workflowEvidence.skipped.dynamicReferences,
    workflowEvidence.skipped.multilineReferences,
    referenceIds.length,
    ...referenceIds,
  ];

  return {
    graphId: explorer.graphId,
    workflowGraphId: workflowEvidence.graphId,
    selectedNodeId,
    key: parts.map(encodePart).join("|"),
  };
}
