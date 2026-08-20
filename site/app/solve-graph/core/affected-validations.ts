import type { SolveGraphNode, SolveGraphNodeKind } from "./contracts";
import type { SolveGraphQueryIndex, SolveGraphTraversalResult } from "./query-impact";

export const MAX_VISIBLE_AFFECTED_VALIDATIONS = 30;

const validationKinds = new Set<SolveGraphNodeKind>(["test", "workflow", "job"]);

export type AffectedValidationCandidate = {
  node: SolveGraphNode;
  depth: number;
  rootId: string;
  parentId?: string;
  viaEdgeId?: string;
};

export type AffectedValidationCandidates = {
  candidates: AffectedValidationCandidate[];
  summary: {
    matchedCandidates: number;
    returnedCandidates: number;
    hiddenCandidates: number;
  };
  queryTruncated: boolean;
  presentationTruncated: boolean;
  notice: string;
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedMaximum(value: number | undefined): number {
  const resolved = value ?? MAX_VISIBLE_AFFECTED_VALIDATIONS;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_VISIBLE_AFFECTED_VALIDATIONS) {
    throw new Error(`Solve Graph affected validation maxCandidates must be an integer from 1 through ${MAX_VISIBLE_AFFECTED_VALIDATIONS}.`);
  }
  return resolved;
}

export function createAffectedValidationCandidates(
  index: SolveGraphQueryIndex,
  impact: SolveGraphTraversalResult,
  options: { maxCandidates?: number } = {},
): AffectedValidationCandidates {
  if (impact.direction !== "dependents") throw new Error("Solve Graph affected validations require dependent impact evidence.");
  const maxCandidates = boundedMaximum(options.maxCandidates);
  const candidates = impact.entries
    .map((entry) => ({ entry, node: index.nodesById.get(entry.id) }))
    .filter((value): value is { entry: SolveGraphTraversalResult["entries"][number]; node: SolveGraphNode } => Boolean(value.node && validationKinds.has(value.node.kind)))
    .sort((left, right) => left.entry.depth - right.entry.depth || compareText(left.entry.rootId, right.entry.rootId) || compareText(left.node.id, right.node.id));
  const visible = candidates.slice(0, maxCandidates).map(({ entry, node }) => ({
    node,
    depth: entry.depth,
    rootId: entry.rootId,
    ...(entry.parentId ? { parentId: entry.parentId } : {}),
    ...(entry.viaEdgeId ? { viaEdgeId: entry.viaEdgeId } : {}),
  }));
  const presentationTruncated = candidates.length > visible.length;
  const queryTruncated = impact.truncated;
  const notices = ["Validation candidates are static graph candidate evidence only; runtime selection and undiscovered validations may differ."];
  if (queryTruncated) notices.push("The bounded impact traversal stopped early, so additional validation candidates may exist.");
  if (presentationTruncated) notices.push("Additional matched validation candidates are hidden by the panel limit.");

  return {
    candidates: visible,
    summary: { matchedCandidates: candidates.length, returnedCandidates: visible.length, hiddenCandidates: candidates.length - visible.length },
    queryTruncated,
    presentationTruncated,
    notice: notices.join(" "),
  };
}
