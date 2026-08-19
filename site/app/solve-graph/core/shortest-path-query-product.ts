import type { SolveGraphQueryIndex } from "./query-impact";
import {
  findSolveGraphShortestPath,
  type SolveGraphShortestPathOptions,
  type SolveGraphShortestPathResult,
} from "./shortest-path";
import {
  createSolveGraphShortestPathProductBundle,
  type SolveGraphShortestPathProductBundle,
} from "./shortest-path-product";

export type SolveGraphShortestPathQueryProductRequest = {
  sourceName: string;
  sourceId: string;
  targetId: string;
  query?: SolveGraphShortestPathOptions;
};

export type SolveGraphShortestPathQueryProduct = {
  schema: "solvelang.solve-graph.shortest-path-query-product.v0";
  mode: "analyze-only";
  graphId: string;
  request: {
    sourceId: string;
    targetId: string;
    direction: SolveGraphShortestPathResult["direction"];
    edgeKinds?: SolveGraphShortestPathOptions["edgeKinds"];
    maxDepth?: number;
    maxVisited?: number;
  };
  query: SolveGraphShortestPathResult;
  product: SolveGraphShortestPathProductBundle;
  execution: {
    networkAccess: false;
    writeAccess: false;
  };
};

function safeSourceName(value: string): string {
  if (typeof value !== "string") {
    throw new Error("Solve Graph shortest-path query product sourceName must be a string.");
  }
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > 255 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("Solve Graph shortest-path query product sourceName is invalid.");
  }
  return normalized;
}

function cloneQuery(result: SolveGraphShortestPathResult): SolveGraphShortestPathResult {
  return {
    direction: result.direction,
    sourceId: result.sourceId,
    targetId: result.targetId,
    found: result.found,
    nodeIds: [...result.nodeIds],
    hops: result.hops.map((hop) => ({ ...hop })),
    visitedCount: result.visitedCount,
    truncated: result.truncated,
    ...(result.truncationReason === undefined ? {} : { truncationReason: result.truncationReason }),
  };
}

export async function createSolveGraphShortestPathQueryProduct(
  index: SolveGraphQueryIndex,
  request: SolveGraphShortestPathQueryProductRequest,
): Promise<SolveGraphShortestPathQueryProduct> {
  const sourceName = safeSourceName(request.sourceName);
  const queryOptions: SolveGraphShortestPathOptions = {
    ...(request.query?.direction === undefined ? {} : { direction: request.query.direction }),
    ...(request.query?.edgeKinds === undefined ? {} : { edgeKinds: [...request.query.edgeKinds] }),
    ...(request.query?.maxDepth === undefined ? {} : { maxDepth: request.query.maxDepth }),
    ...(request.query?.maxVisited === undefined ? {} : { maxVisited: request.query.maxVisited }),
  };
  const query = findSolveGraphShortestPath(index, request.sourceId, request.targetId, queryOptions);
  const product = await createSolveGraphShortestPathProductBundle(sourceName, index, query);

  if (product.graphId !== index.document.graphId
    || product.sourceId !== query.sourceId
    || product.targetId !== query.targetId
    || product.direction !== query.direction
    || product.found !== query.found
    || product.execution.networkAccess !== false
    || product.execution.writeAccess !== false) {
    throw new Error("Solve Graph shortest-path query product identity changed during composition.");
  }

  return {
    schema: "solvelang.solve-graph.shortest-path-query-product.v0",
    mode: "analyze-only",
    graphId: index.document.graphId,
    request: {
      sourceId: request.sourceId,
      targetId: request.targetId,
      direction: query.direction,
      ...(queryOptions.edgeKinds === undefined ? {} : { edgeKinds: [...queryOptions.edgeKinds] }),
      ...(queryOptions.maxDepth === undefined ? {} : { maxDepth: queryOptions.maxDepth }),
      ...(queryOptions.maxVisited === undefined ? {} : { maxVisited: queryOptions.maxVisited }),
    },
    query: cloneQuery(query),
    product,
    execution: {
      networkAccess: false,
      writeAccess: false,
    },
  };
}
