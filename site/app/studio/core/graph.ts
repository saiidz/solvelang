import type { WorkflowDocument, WorkflowEdge, WorkflowNode } from "./types";

export interface GraphIndex {
  nodesById: Map<string, WorkflowNode>;
  outgoing: Map<string, WorkflowEdge[]>;
  incoming: Map<string, WorkflowEdge[]>;
  validEdges: WorkflowEdge[];
}

export function buildGraphIndex(workflow: WorkflowDocument): GraphIndex {
  const nodesById = new Map<string, WorkflowNode>();
  for (const node of workflow.nodes) if (!nodesById.has(node.id)) nodesById.set(node.id, node);
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();
  const validEdges = workflow.edges.filter((edge) => nodesById.has(edge.source) && nodesById.has(edge.target));
  for (const edge of validEdges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge].sort((a, b) => a.priority - b.priority));
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }
  return { nodesById, outgoing, incoming, validEdges };
}

export function reachableNodes(index: GraphIndex, starts: string[]): Set<string> {
  const visited = new Set<string>();
  const queue = [...starts];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id) || !index.nodesById.has(id)) continue;
    visited.add(id);
    for (const edge of index.outgoing.get(id) ?? []) queue.push(edge.target);
  }
  return visited;
}

export function canReachType(index: GraphIndex, start: string, types: Set<string>): boolean {
  const visited = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = index.nodesById.get(id);
    if (id !== start && node && types.has(node.type)) return true;
    for (const edge of index.outgoing.get(id) ?? []) queue.push(edge.target);
  }
  return false;
}

export function findCycles(index: GraphIndex): string[][] {
  const cycles: string[][] = [];
  const seenKeys = new Set<string>();
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string) => {
    if (active.has(id)) {
      const start = stack.indexOf(id);
      const cycle = stack.slice(start);
      const key = [...cycle].sort().join("|");
      if (!seenKeys.has(key)) { seenKeys.add(key); cycles.push(cycle); }
      return;
    }
    if (visited.has(id)) return;
    visited.add(id); active.add(id); stack.push(id);
    for (const edge of index.outgoing.get(id) ?? []) visit(edge.target);
    stack.pop(); active.delete(id);
  };

  for (const id of index.nodesById.keys()) visit(id);
  return cycles;
}

export function pathDepths(index: GraphIndex, starts: string[], limit = 200): number[] {
  const depths: number[] = [];
  const walk = (id: string, depth: number, visitedEdges: Set<string>) => {
    if (depth >= limit) { depths.push(depth); return; }
    const outgoing = index.outgoing.get(id) ?? [];
    if (!outgoing.length) { depths.push(depth); return; }
    let advanced = false;
    for (const edge of outgoing) {
      if (visitedEdges.has(edge.id)) continue;
      advanced = true;
      const next = new Set(visitedEdges); next.add(edge.id);
      walk(edge.target, depth + 1, next);
    }
    if (!advanced) depths.push(depth);
  };
  for (const start of starts) walk(start, 1, new Set());
  return depths.length ? depths : [0];
}
