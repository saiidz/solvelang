import { createHash } from "node:crypto";
import {
  SOLVE_GRAPH_TOOL_API_VERSION,
  solveGraphEdgeKinds,
  type SolveGraphDocument,
  type SolveGraphEdge,
  type SolveGraphEdgeKind,
  type SolveGraphNode,
  type SolveGraphToolNode,
} from "./solve-graph.js";

export const MAX_SOLVE_GRAPH_CYCLE_COMPONENTS = 100;
export const MAX_SOLVE_GRAPH_CYCLE_COMPONENT_NODES = 100;

export type SolveGraphCycleOptions = {
  edgeKinds?: readonly SolveGraphEdgeKind[];
  maxComponents?: number;
  maxNodesPerComponent?: number;
};

export type SolveGraphCycleResponse = {
  apiVersion: typeof SOLVE_GRAPH_TOOL_API_VERSION;
  tool: "solve_graph.cycles";
  graphId: string;
  cycles: Array<{
    id: string;
    nodes: SolveGraphToolNode[];
    representativeCycle: SolveGraphToolNode[];
    truncated: boolean;
  }>;
  summary: {
    cycleComponents: number;
    returnedComponents: number;
    hiddenComponents: number;
  };
  truncated: boolean;
  truncationReasons: Array<"component-count" | "component-node-count">;
  notices: string[];
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxComponents: number;
    maxNodesPerComponent: number;
  };
};

const edgeKindSet = new Set<string>(solveGraphEdgeKinds);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return resolved;
}

function normalizedEdgeKinds(values: readonly SolveGraphEdgeKind[] | undefined): Set<SolveGraphEdgeKind> | undefined {
  if (values === undefined) return undefined;
  const result = new Set<SolveGraphEdgeKind>();
  for (const value of values) {
    if (!edgeKindSet.has(value)) throw new Error(`Solve Graph cycle edge kind is invalid: ${value}`);
    result.add(value);
  }
  return result;
}

function safeNode(node: SolveGraphNode): SolveGraphToolNode {
  const path = node.metadata?.path;
  const packageName = node.metadata?.packageName;
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    ...(typeof path === "string" ? { path } : {}),
    ...(typeof packageName === "string" ? { packageName } : {}),
  };
}

function cycleId(graphId: string, nodeIds: readonly string[]): string {
  const value = JSON.stringify({ graphId, nodeIds });
  return `sgc_${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32)}`;
}

function adjacency(document: SolveGraphDocument, edgeKinds: Set<SolveGraphEdgeKind> | undefined): Map<string, SolveGraphEdge[]> {
  const result = new Map(document.nodes.map((node) => [node.id, [] as SolveGraphEdge[]]));
  for (const edge of document.edges) {
    if (!edgeKinds || edgeKinds.has(edge.kind)) result.get(edge.from)?.push(edge);
  }
  for (const edges of result.values()) edges.sort((left, right) => compareText(left.id, right.id));
  return result;
}

function stronglyConnectedComponents(nodeIds: readonly string[], edgesByNode: ReadonlyMap<string, readonly SolveGraphEdge[]>): string[][] {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (nodeId: string): void => {
    indexes.set(nodeId, nextIndex);
    lowlinks.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const edge of edgesByNode.get(nodeId) ?? []) {
      if (!indexes.has(edge.to)) {
        visit(edge.to);
        lowlinks.set(nodeId, Math.min(lowlinks.get(nodeId)!, lowlinks.get(edge.to)!));
      } else if (onStack.has(edge.to)) {
        lowlinks.set(nodeId, Math.min(lowlinks.get(nodeId)!, indexes.get(edge.to)!));
      }
    }

    if (lowlinks.get(nodeId) !== indexes.get(nodeId)) return;
    const component: string[] = [];
    while (true) {
      const current = stack.pop();
      if (!current) throw new Error("Solve Graph cycle analysis stack underflow.");
      onStack.delete(current);
      component.push(current);
      if (current === nodeId) break;
    }
    component.sort(compareText);
    const hasSelfLoop = component.length === 1 && (edgesByNode.get(component[0]!) ?? []).some((edge) => edge.to === component[0]);
    if (component.length > 1 || hasSelfLoop) components.push(component);
  };

  for (const nodeId of [...nodeIds].sort(compareText)) if (!indexes.has(nodeId)) visit(nodeId);
  return components.sort((left, right) => compareText(left[0]!, right[0]!));
}

function representativeCycle(component: readonly string[], edgesByNode: ReadonlyMap<string, readonly SolveGraphEdge[]>): string[] {
  const allowed = new Set(component);
  const start = component[0]!;
  const path = [start];
  const visiting = new Set(path);
  const find = (current: string): string[] | undefined => {
    for (const edge of edgesByNode.get(current) ?? []) {
      if (!allowed.has(edge.to)) continue;
      if (edge.to === start) return [...path, start];
      if (visiting.has(edge.to)) continue;
      visiting.add(edge.to);
      path.push(edge.to);
      const found = find(edge.to);
      if (found) return found;
      path.pop();
      visiting.delete(edge.to);
    }
    return undefined;
  };
  const found = find(start);
  if (!found) throw new Error("Solve Graph cycle analysis could not construct a representative cycle.");
  return found;
}

export function findSolveGraphCycles(document: SolveGraphDocument, options: SolveGraphCycleOptions = {}): SolveGraphCycleResponse {
  if (document.mode !== "analyze-only" || document.execution.networkAccess !== false || document.execution.writeAccess !== false) {
    throw new Error("Solve Graph cycle analysis requires an analyze-only document with networkAccess=false and writeAccess=false.");
  }
  const edgeKinds = normalizedEdgeKinds(options.edgeKinds);
  const maxComponents = boundedInteger(options.maxComponents, 25, MAX_SOLVE_GRAPH_CYCLE_COMPONENTS, "Solve Graph cycle maxComponents");
  const maxNodesPerComponent = boundedInteger(options.maxNodesPerComponent, 25, MAX_SOLVE_GRAPH_CYCLE_COMPONENT_NODES, "Solve Graph cycle maxNodesPerComponent");
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const edgesByNode = adjacency(document, edgeKinds);
  const components = stronglyConnectedComponents(document.nodes.map((node) => node.id), edgesByNode);
  const visibleComponents = components.slice(0, maxComponents);
  const componentCountTruncated = components.length > visibleComponents.length;
  let componentNodeTruncated = false;
  const cycles = visibleComponents.map((component) => {
    const visibleNodeIds = component.slice(0, maxNodesPerComponent);
    const truncated = component.length > visibleNodeIds.length;
    componentNodeTruncated ||= truncated;
    return {
      id: cycleId(document.graphId, component),
      nodes: visibleNodeIds.map((nodeId) => safeNode(nodesById.get(nodeId)!)),
      representativeCycle: representativeCycle(component, edgesByNode).map((nodeId) => safeNode(nodesById.get(nodeId)!)),
      truncated,
    };
  });
  const truncationReasons: Array<"component-count" | "component-node-count"> = [
    ...(componentCountTruncated ? ["component-count" as const] : []),
    ...(componentNodeTruncated ? ["component-node-count" as const] : []),
  ];
  return {
    apiVersion: SOLVE_GRAPH_TOOL_API_VERSION,
    tool: "solve_graph.cycles",
    graphId: document.graphId,
    cycles,
    summary: {
      cycleComponents: components.length,
      returnedComponents: cycles.length,
      hiddenComponents: components.length - cycles.length,
    },
    truncated: truncationReasons.length > 0,
    truncationReasons,
    notices: [
      "Cycle components are structural evidence only; they are not automatically defects.",
      ...(componentCountTruncated ? ["Additional cycle components were omitted by the component-count bound."] : []),
      ...(componentNodeTruncated ? ["At least one returned component omits nodes by the per-component node bound."] : []),
    ],
    execution: { networkAccess: false, writeAccess: false, maxComponents, maxNodesPerComponent },
  };
}
