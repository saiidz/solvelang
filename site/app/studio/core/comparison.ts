import type { ScenarioRun, WorkflowDocument } from "./types";

function difference(left: string[], right: string[]) { return left.filter((item) => !right.includes(item)); }

export function compareScenarioRuns(workflow: WorkflowDocument, before: ScenarioRun, after: ScenarioRun) {
  const nodeMap = new Map(workflow.nodes.map((node) => [node.id, node]));
  const beforeOwners = [...new Set(before.path.map((id) => nodeMap.get(id)?.owner).filter(Boolean) as string[])];
  const afterOwners = [...new Set(after.path.map((id) => nodeMap.get(id)?.owner).filter(Boolean) as string[])];
  const beforeDecisions = before.trace.filter((event) => event.decision).map((event) => `${event.nodeId}:${event.decision}`);
  const afterDecisions = after.trace.filter((event) => event.decision).map((event) => `${event.nodeId}:${event.decision}`);
  const beforeRisk = Math.max(0, ...before.path.map((id) => ["low", "medium", "high", "critical"].indexOf(nodeMap.get(id)?.riskLevel ?? "low")));
  const afterRisk = Math.max(0, ...after.path.map((id) => ["low", "medium", "high", "critical"].indexOf(nodeMap.get(id)?.riskLevel ?? "low")));
  return {
    path: { added: difference(after.path, before.path), removed: difference(before.path, after.path) },
    owners: { added: difference(afterOwners, beforeOwners), removed: difference(beforeOwners, afterOwners) },
    decisions: { added: difference(afterDecisions, beforeDecisions), removed: difference(beforeDecisions, afterDecisions) },
    humanReview: { added: difference(after.humanReviewPauses, before.humanReviewPauses), removed: difference(before.humanReviewPauses, after.humanReviewPauses) },
    sla: { before: before.elapsedSlaMinutes, after: after.elapsedSlaMinutes, delta: after.elapsedSlaMinutes - before.elapsedSlaMinutes },
    risk: { before: beforeRisk, after: afterRisk, changed: beforeRisk !== afterRisk },
    outputs: { added: difference(after.outputs, before.outputs), removed: difference(before.outputs, after.outputs) },
    terminal: { before: before.terminalResult, after: after.terminalResult, changed: before.terminalResult !== after.terminalResult },
  };
}
