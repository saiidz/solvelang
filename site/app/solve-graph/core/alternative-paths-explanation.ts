import type { SolveGraphNode } from "./contracts";
import type { SolveGraphAlternativePathsProductBundle } from "./alternative-paths-product";

const MAX_EXPLANATION_PATHS = 64;
const MAX_EXPLANATION_HOPS = 32;
const MAX_EXPLANATION_NOTICES = 8;

export type SolveGraphAlternativePathsExplanationNode = {
  id: string;
  kind: SolveGraphNode["kind"];
  label: string;
};

export type SolveGraphAlternativePathsExplanationStep = {
  index: number;
  edgeId: string;
  edgeKind: SolveGraphAlternativePathsProductBundle["presentation"]["rows"][number]["hops"][number]["edgeKind"];
  from: SolveGraphAlternativePathsExplanationNode;
  to: SolveGraphAlternativePathsExplanationNode;
  sentence: string;
};

export type SolveGraphAlternativePathExplanation = {
  pathIndex: number;
  hopCount: number;
  nodes: SolveGraphAlternativePathsExplanationNode[];
  steps: SolveGraphAlternativePathsExplanationStep[];
  sentence: string;
};

export type SolveGraphAlternativePathsExplanation = {
  schema: "solvelang.solve-graph.alternative-paths-explanation.v0";
  mode: "analyze-only";
  graphId: string;
  direction: SolveGraphAlternativePathsProductBundle["direction"];
  sourceId: string;
  targetId: string;
  status: "complete" | "partial";
  headline: string;
  detail: string;
  paths: SolveGraphAlternativePathExplanation[];
  notices: string[];
  summary: {
    availablePaths: number;
    explainedPaths: number;
    hiddenPaths: number;
    minimumHops?: number;
    maximumHops?: number;
    statesCreated: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    queryTruncated: boolean;
    presentationRowsTruncated: boolean;
  };
};

function explanationNode(
  node: SolveGraphAlternativePathsProductBundle["presentation"]["rows"][number]["nodes"][number],
): SolveGraphAlternativePathsExplanationNode {
  return { id: node.id, kind: node.kind, label: node.label };
}

function assertProductBundle(bundle: SolveGraphAlternativePathsProductBundle): void {
  const { artifact } = bundle.download;
  const { presentation } = bundle;

  if (bundle.schema !== "solvelang.solve-graph.alternative-paths-product.v0" || bundle.mode !== "analyze-only") {
    throw new Error("Solve Graph alternative-path explanation requires a v0 analyze-only product bundle.");
  }
  if (bundle.execution.networkAccess !== false
    || bundle.execution.writeAccess !== false
    || artifact.execution.networkAccess !== false
    || artifact.execution.writeAccess !== false
    || presentation.execution.networkAccess !== false
    || presentation.execution.writeAccess !== false) {
    throw new Error("Solve Graph alternative-path explanation requires capability-free product inputs.");
  }

  const expectedStatus = bundle.execution.queryTruncated || bundle.execution.presentationRowsTruncated
    ? "partial"
    : "complete";
  if (bundle.status !== expectedStatus
    || presentation.status !== expectedStatus
    || artifact.truncated !== bundle.execution.queryTruncated
    || presentation.execution.queryTruncated !== bundle.execution.queryTruncated
    || presentation.execution.presentationTruncated !== bundle.execution.presentationRowsTruncated) {
    throw new Error("Solve Graph alternative-path explanation received inconsistent completeness truth.");
  }
  if (bundle.graphId !== artifact.graphId
    || bundle.graphId !== presentation.graphId
    || bundle.direction !== artifact.direction
    || bundle.direction !== presentation.direction
    || bundle.sourceId !== artifact.sourceId
    || bundle.sourceId !== presentation.sourceId
    || bundle.targetId !== artifact.targetId
    || bundle.targetId !== presentation.targetId) {
    throw new Error("Solve Graph alternative-path explanation received inconsistent product identity.");
  }

  const { summary, rows } = presentation;
  if (!Number.isSafeInteger(summary.availablePaths)
    || summary.availablePaths < 0
    || summary.availablePaths > MAX_EXPLANATION_PATHS
    || summary.availablePaths !== artifact.paths.length
    || summary.shownPaths !== rows.length
    || summary.hiddenPaths !== summary.availablePaths - summary.shownPaths
    || summary.statesCreated !== artifact.statesCreated
    || !Number.isSafeInteger(summary.statesCreated)
    || summary.statesCreated < 1
    || summary.statesCreated > 50_000) {
    throw new Error("Solve Graph alternative-path explanation received inconsistent path counts.");
  }
  if (rows.length > MAX_EXPLANATION_PATHS) {
    throw new Error(`Solve Graph alternative-path explanation exceeds ${MAX_EXPLANATION_PATHS} visible paths.`);
  }
  if (presentation.notices.length > MAX_EXPLANATION_NOTICES) {
    throw new Error(`Solve Graph alternative-path explanation exceeds ${MAX_EXPLANATION_NOTICES} notices.`);
  }

  const hopCounts = artifact.paths.map((path) => path.hops.length);
  const expectedMinimum = hopCounts.length === 0 ? undefined : Math.min(...hopCounts);
  const expectedMaximum = hopCounts.length === 0 ? undefined : Math.max(...hopCounts);
  if (summary.minimumHops !== expectedMinimum || summary.maximumHops !== expectedMaximum) {
    throw new Error("Solve Graph alternative-path explanation received inconsistent hop-count summary.");
  }

  rows.forEach((row, rowIndex) => {
    const artifactPath = artifact.paths[rowIndex];
    if (!artifactPath || row.pathIndex !== rowIndex || row.hopCount !== row.hops.length) {
      throw new Error("Solve Graph alternative-path explanation received inconsistent visible-path ordering.");
    }
    if (row.hops.length > MAX_EXPLANATION_HOPS || row.nodes.length !== row.hops.length + 1) {
      throw new Error("Solve Graph alternative-path explanation received an invalid path shape.");
    }
    if (row.nodes.length !== artifactPath.nodeIds.length
      || row.nodes[0]?.id !== bundle.sourceId
      || row.nodes[row.nodes.length - 1]?.id !== bundle.targetId) {
      throw new Error("Solve Graph alternative-path explanation received invalid path endpoints.");
    }
    if (new Set(row.nodes.map((node) => node.id)).size !== row.nodes.length) {
      throw new Error("Solve Graph alternative-path explanation paths must remain simple and cycle-free.");
    }

    row.nodes.forEach((node, nodeIndex) => {
      if (node.id !== artifactPath.nodeIds[nodeIndex]) {
        throw new Error("Solve Graph alternative-path explanation received mismatched node ordering.");
      }
    });
    row.hops.forEach((hop, hopIndex) => {
      const artifactHop = artifactPath.hops[hopIndex];
      const from = row.nodes[hopIndex];
      const to = row.nodes[hopIndex + 1];
      if (!artifactHop
        || !from
        || !to
        || hop.edgeId !== artifactHop.edgeId
        || hop.edgeKind !== artifactHop.edgeKind
        || hop.from !== artifactHop.from
        || hop.to !== artifactHop.to
        || hop.from !== from.id
        || hop.to !== to.id) {
        throw new Error("Solve Graph alternative-path explanation received mismatched hop evidence.");
      }
    });
  });
}

function headline(bundle: SolveGraphAlternativePathsProductBundle): string {
  const count = bundle.presentation.summary.availablePaths;
  if (count === 1 && bundle.sourceId === bundle.targetId) return "Source and target are the same node";
  if (bundle.status === "partial") {
    return bundle.direction === "dependencies"
      ? "Dependency path evidence is partial"
      : "Dependent path evidence is partial";
  }
  if (count === 0) {
    return bundle.direction === "dependencies"
      ? "No dependency paths found"
      : "No dependent paths found";
  }
  return `${count} ${bundle.direction === "dependencies" ? "dependency" : "dependent"} path${count === 1 ? "" : "s"} observed`;
}

function detail(bundle: SolveGraphAlternativePathsProductBundle): string {
  const { availablePaths, shownPaths, hiddenPaths, statesCreated } = bundle.presentation.summary;
  if (availablePaths === 1 && bundle.sourceId === bundle.targetId) {
    return `The query resolved immediately as one zero-hop path after creating ${statesCreated} traversal state.`;
  }
  if (bundle.execution.queryTruncated) {
    return `${availablePaths} path${availablePaths === 1 ? "" : "s"} were observed before the bounded query stopped after creating ${statesCreated} traversal state${statesCreated === 1 ? "" : "s"}; additional paths may exist.`;
  }
  if (bundle.execution.presentationRowsTruncated) {
    return `The query completed with ${availablePaths} path${availablePaths === 1 ? "" : "s"}; this bounded presentation explains ${shownPaths} and hides ${hiddenPaths}.`;
  }
  if (availablePaths === 0) {
    return `No path exists within the completely searched configured graph scope after creating ${statesCreated} traversal state${statesCreated === 1 ? "" : "s"}.`;
  }
  return `The complete bounded query observed ${availablePaths} path${availablePaths === 1 ? "" : "s"} after creating ${statesCreated} traversal state${statesCreated === 1 ? "" : "s"}.`;
}

export function createSolveGraphAlternativePathsExplanation(
  bundle: SolveGraphAlternativePathsProductBundle,
): SolveGraphAlternativePathsExplanation {
  assertProductBundle(bundle);

  const paths = bundle.presentation.rows.map((row) => {
    const nodes = row.nodes.map(explanationNode);
    const steps = row.hops.map((hop, hopIndex) => {
      const from = nodes[hopIndex]!;
      const to = nodes[hopIndex + 1]!;
      return {
        index: hopIndex + 1,
        edgeId: hop.edgeId,
        edgeKind: hop.edgeKind,
        from,
        to,
        sentence: `${from.label} --${hop.edgeKind}--> ${to.label}`,
      };
    });
    return {
      pathIndex: row.pathIndex,
      hopCount: row.hopCount,
      nodes,
      steps,
      sentence: row.hopCount === 0
        ? `${nodes[0]!.label} is both the source and target.`
        : `Path ${row.pathIndex + 1} contains ${row.hopCount} hop${row.hopCount === 1 ? "" : "s"}.`,
    };
  });

  const summary = bundle.presentation.summary;
  return {
    schema: "solvelang.solve-graph.alternative-paths-explanation.v0",
    mode: "analyze-only",
    graphId: bundle.graphId,
    direction: bundle.direction,
    sourceId: bundle.sourceId,
    targetId: bundle.targetId,
    status: bundle.status,
    headline: headline(bundle),
    detail: detail(bundle),
    paths,
    notices: [...bundle.presentation.notices],
    summary: {
      availablePaths: summary.availablePaths,
      explainedPaths: summary.shownPaths,
      hiddenPaths: summary.hiddenPaths,
      ...(summary.minimumHops === undefined ? {} : { minimumHops: summary.minimumHops }),
      ...(summary.maximumHops === undefined ? {} : { maximumHops: summary.maximumHops }),
      statesCreated: summary.statesCreated,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      queryTruncated: bundle.execution.queryTruncated,
      presentationRowsTruncated: bundle.execution.presentationRowsTruncated,
    },
  };
}
