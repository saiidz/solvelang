import { analyzeWorkflow } from "./analysis";
import type { VersionSnapshot, WorkflowDocument } from "./types";

function fingerprint(document: WorkflowDocument) {
  const copy = structuredClone(document);
  copy.updatedAt = "";
  copy.analytics.lastAnalyzedAt = null;
  return JSON.stringify(copy);
}

export function createVersionSnapshot(document: WorkflowDocument, label: string, summary: string, existing: VersionSnapshot[]): VersionSnapshot[] {
  const nextFingerprint = fingerprint(document);
  if (existing[0]?.fingerprint === nextFingerprint) return existing;
  const snapshot: VersionSnapshot = {
    id: `version-${crypto.randomUUID()}`, label, timestamp: new Date().toISOString(), summary,
    nodeCount: document.nodes.length, edgeCount: document.edges.length, scoreSnapshot: analyzeWorkflow(document).score.value,
    fingerprint: nextFingerprint, document: structuredClone(document),
  };
  return [snapshot, ...existing].slice(0, 30);
}

export function compareVersions(before: VersionSnapshot, after: VersionSnapshot) {
  const beforeNodes = new Map(before.document.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.document.nodes.map((node) => [node.id, node]));
  const beforeEdges = new Map(before.document.edges.map((edge) => [edge.id, edge]));
  const afterEdges = new Map(after.document.edges.map((edge) => [edge.id, edge]));
  const beforePolicies = new Map(before.document.policies.map((policy) => [policy.id, policy]));
  const afterPolicies = new Map(after.document.policies.map((policy) => [policy.id, policy]));
  return {
    nodesAdded: [...afterNodes.keys()].filter((id) => !beforeNodes.has(id)), nodesRemoved: [...beforeNodes.keys()].filter((id) => !afterNodes.has(id)),
    nodesModified: [...afterNodes.keys()].filter((id) => beforeNodes.has(id) && JSON.stringify(beforeNodes.get(id)) !== JSON.stringify(afterNodes.get(id))),
    edgesAdded: [...afterEdges.keys()].filter((id) => !beforeEdges.has(id)), edgesRemoved: [...beforeEdges.keys()].filter((id) => !afterEdges.has(id)),
    policiesChanged: [...new Set([...beforePolicies.keys(), ...afterPolicies.keys()])].filter((id) => JSON.stringify(beforePolicies.get(id)) !== JSON.stringify(afterPolicies.get(id))),
    scenariosChanged: JSON.stringify(before.document.scenarios) !== JSON.stringify(after.document.scenarios),
    scoreChange: after.scoreSnapshot - before.scoreSnapshot,
  };
}
