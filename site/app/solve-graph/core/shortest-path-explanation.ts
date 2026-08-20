import type { SolveGraphNode } from "./contracts";
import type { SolveGraphShortestPathProductBundle } from "./shortest-path-product";

const MAX_EXPLANATION_HOPS = 64;
const MAX_EXPLANATION_NOTICES = 8;

export type SolveGraphShortestPathExplanationNode = {
  id: string;
  kind: SolveGraphNode["kind"];
  label: string;
};

export type SolveGraphShortestPathExplanationStep = {
  index: number;
  edgeId: string;
  edgeKind: SolveGraphShortestPathProductBundle["presentation"]["hops"][number]["edgeKind"];
  from: SolveGraphShortestPathExplanationNode;
  to: SolveGraphShortestPathExplanationNode;
  sentence: string;
};

export type SolveGraphShortestPathExplanation = {
  schema: "solvelang.solve-graph.shortest-path-explanation.v0";
  mode: "analyze-only";
  graphId: string;
  direction: SolveGraphShortestPathProductBundle["direction"];
  sourceId: string;
  targetId: string;
  found: boolean;
  status: "complete" | "partial";
  headline: string;
  detail: string;
  steps: SolveGraphShortestPathExplanationStep[];
  notices: string[];
  summary: {
    hopCount: number;
    visitedCount: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    queryTruncated: boolean;
  };
};

function explanationNode(
  node: SolveGraphShortestPathProductBundle["presentation"]["nodes"][number],
): SolveGraphShortestPathExplanationNode {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
  };
}

function assertProductBundle(bundle: SolveGraphShortestPathProductBundle): void {
  const { artifact } = bundle.download;
  const { presentation } = bundle;

  if (bundle.schema !== "solvelang.solve-graph.shortest-path-product.v0" || bundle.mode !== "analyze-only") {
    throw new Error("Solve Graph shortest-path explanation requires a v0 analyze-only product bundle.");
  }
  if (bundle.execution.networkAccess !== false
    || bundle.execution.writeAccess !== false
    || artifact.execution.networkAccess !== false
    || artifact.execution.writeAccess !== false
    || presentation.execution.networkAccess !== false
    || presentation.execution.writeAccess !== false) {
    throw new Error("Solve Graph shortest-path explanation requires capability-free product inputs.");
  }
  if (bundle.status !== (bundle.execution.queryTruncated ? "partial" : "complete")
    || presentation.status !== bundle.status
    || artifact.truncated !== bundle.execution.queryTruncated
    || presentation.execution.queryTruncated !== bundle.execution.queryTruncated) {
    throw new Error("Solve Graph shortest-path explanation received inconsistent completeness truth.");
  }
  if (bundle.graphId !== artifact.graphId
    || bundle.graphId !== presentation.graphId
    || bundle.direction !== artifact.direction
    || bundle.direction !== presentation.direction
    || bundle.sourceId !== artifact.sourceId
    || bundle.sourceId !== presentation.sourceId
    || bundle.targetId !== artifact.targetId
    || bundle.targetId !== presentation.targetId
    || bundle.found !== artifact.found
    || bundle.found !== presentation.found) {
    throw new Error("Solve Graph shortest-path explanation received inconsistent product identity.");
  }
  if (presentation.summary.hopCount !== presentation.hops.length
    || presentation.hops.length !== artifact.hops.length
    || presentation.nodes.length !== artifact.nodeIds.length
    || presentation.summary.visitedCount < 1
    || !Number.isSafeInteger(presentation.summary.visitedCount)) {
    throw new Error("Solve Graph shortest-path explanation received inconsistent path counts.");
  }
  if (presentation.hops.length > MAX_EXPLANATION_HOPS) {
    throw new Error(`Solve Graph shortest-path explanation exceeds ${MAX_EXPLANATION_HOPS} hops.`);
  }
  if (presentation.notices.length > MAX_EXPLANATION_NOTICES) {
    throw new Error(`Solve Graph shortest-path explanation exceeds ${MAX_EXPLANATION_NOTICES} notices.`);
  }

  if (!bundle.found) {
    if (presentation.nodes.length !== 0 || presentation.hops.length !== 0 || artifact.nodeIds.length !== 0) {
      throw new Error("Solve Graph shortest-path explanation cannot explain path steps when found=false.");
    }
    return;
  }

  if (bundle.execution.queryTruncated) {
    throw new Error("Solve Graph shortest-path explanation cannot mark a found path as partial.");
  }
  if (presentation.nodes.length !== presentation.hops.length + 1 || presentation.nodes.length === 0) {
    throw new Error("Solve Graph shortest-path explanation received an invalid found-path shape.");
  }
  if (presentation.nodes[0]!.id !== bundle.sourceId
    || presentation.nodes[presentation.nodes.length - 1]!.id !== bundle.targetId) {
    throw new Error("Solve Graph shortest-path explanation received invalid path endpoints.");
  }

  presentation.nodes.forEach((node, index) => {
    if (node.id !== artifact.nodeIds[index]) {
      throw new Error("Solve Graph shortest-path explanation received mismatched node ordering.");
    }
  });
  presentation.hops.forEach((hop, index) => {
    const artifactHop = artifact.hops[index];
    const from = presentation.nodes[index];
    const to = presentation.nodes[index + 1];
    if (!artifactHop
      || !from
      || !to
      || hop.edgeId !== artifactHop.edgeId
      || hop.edgeKind !== artifactHop.edgeKind
      || hop.from !== artifactHop.from
      || hop.to !== artifactHop.to
      || hop.from !== from.id
      || hop.to !== to.id) {
      throw new Error("Solve Graph shortest-path explanation received mismatched hop evidence.");
    }
  });
}

function headline(bundle: SolveGraphShortestPathProductBundle): string {
  if (bundle.found && bundle.sourceId === bundle.targetId) return "Source and target are the same node";
  if (bundle.found) return bundle.direction === "dependencies" ? "Dependency path found" : "Dependent path found";
  if (bundle.status === "partial") {
    return bundle.direction === "dependencies" ? "Dependency path search incomplete" : "Dependent path search incomplete";
  }
  return bundle.direction === "dependencies" ? "No dependency path found" : "No dependent path found";
}

function detail(bundle: SolveGraphShortestPathProductBundle): string {
  const { hopCount, visitedCount } = bundle.presentation.summary;
  if (bundle.found && hopCount === 0) {
    return `The query resolved immediately after visiting ${visitedCount} node.`;
  }
  if (bundle.found) {
    return `The shortest observed path contains ${hopCount} hop${hopCount === 1 ? "" : "s"} after visiting ${visitedCount} node${visitedCount === 1 ? "" : "s"}.`;
  }
  if (bundle.status === "partial") {
    return `No path was established before the bounded search stopped after visiting ${visitedCount} node${visitedCount === 1 ? "" : "s"}; absence is not proven.`;
  }
  return `No path exists within the completely searched configured graph scope after visiting ${visitedCount} node${visitedCount === 1 ? "" : "s"}.`;
}

export function createSolveGraphShortestPathExplanation(
  bundle: SolveGraphShortestPathProductBundle,
): SolveGraphShortestPathExplanation {
  assertProductBundle(bundle);

  const steps = bundle.presentation.hops.map((hop, index) => {
    const from = explanationNode(bundle.presentation.nodes[index]!);
    const to = explanationNode(bundle.presentation.nodes[index + 1]!);
    return {
      index: index + 1,
      edgeId: hop.edgeId,
      edgeKind: hop.edgeKind,
      from,
      to,
      sentence: `${from.label} --${hop.edgeKind}--> ${to.label}`,
    };
  });

  return {
    schema: "solvelang.solve-graph.shortest-path-explanation.v0",
    mode: "analyze-only",
    graphId: bundle.graphId,
    direction: bundle.direction,
    sourceId: bundle.sourceId,
    targetId: bundle.targetId,
    found: bundle.found,
    status: bundle.status,
    headline: headline(bundle),
    detail: detail(bundle),
    steps,
    notices: [...bundle.presentation.notices],
    summary: {
      hopCount: bundle.presentation.summary.hopCount,
      visitedCount: bundle.presentation.summary.visitedCount,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      queryTruncated: bundle.execution.queryTruncated,
    },
  };
}
