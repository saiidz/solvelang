import {
  findSolveGraphAlternativePaths,
  type SolveGraphAlternativePathsOptions,
  type SolveGraphAlternativePathsResult,
} from "./alternative-paths";
import {
  createSolveGraphAlternativePathsProductBundle,
  type SolveGraphAlternativePathsProductBundle,
} from "./alternative-paths-product";
import type { SolveGraphQueryIndex } from "./query-impact";

export type SolveGraphAlternativePathsQueryProductRequest = {
  sourceName: string;
  sourceId: string;
  targetId: string;
  query?: SolveGraphAlternativePathsOptions;
  presentation?: {
    maxPaths?: number;
  };
};

export type SolveGraphAlternativePathsQueryProduct = {
  schema: "solvelang.solve-graph.alternative-paths-query-product.v0";
  mode: "analyze-only";
  graphId: string;
  request: {
    sourceId: string;
    targetId: string;
    direction: SolveGraphAlternativePathsResult["direction"];
    edgeKinds?: SolveGraphAlternativePathsOptions["edgeKinds"];
    maxDepth?: number;
    maxPaths?: number;
    maxStates?: number;
    presentationMaxPaths?: number;
  };
  query: SolveGraphAlternativePathsResult;
  product: SolveGraphAlternativePathsProductBundle;
  execution: {
    networkAccess: false;
    writeAccess: false;
  };
};

function safeSourceName(value: string): string {
  if (typeof value !== "string") {
    throw new Error("Solve Graph alternative-path query product sourceName must be a string.");
  }
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > 255 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("Solve Graph alternative-path query product sourceName is invalid.");
  }
  return normalized;
}

function cloneQueryResult(result: SolveGraphAlternativePathsResult): SolveGraphAlternativePathsResult {
  return {
    direction: result.direction,
    sourceId: result.sourceId,
    targetId: result.targetId,
    paths: result.paths.map((path) => ({
      nodeIds: [...path.nodeIds],
      hops: path.hops.map((hop) => ({ ...hop })),
    })),
    statesCreated: result.statesCreated,
    truncated: result.truncated,
    ...(result.truncationReason === undefined ? {} : { truncationReason: result.truncationReason }),
  };
}

export async function createSolveGraphAlternativePathsQueryProduct(
  index: SolveGraphQueryIndex,
  request: SolveGraphAlternativePathsQueryProductRequest,
): Promise<SolveGraphAlternativePathsQueryProduct> {
  const sourceName = safeSourceName(request.sourceName);
  const queryOptions: SolveGraphAlternativePathsOptions = {
    ...(request.query?.direction === undefined ? {} : { direction: request.query.direction }),
    ...(request.query?.edgeKinds === undefined ? {} : { edgeKinds: [...request.query.edgeKinds] }),
    ...(request.query?.maxDepth === undefined ? {} : { maxDepth: request.query.maxDepth }),
    ...(request.query?.maxPaths === undefined ? {} : { maxPaths: request.query.maxPaths }),
    ...(request.query?.maxStates === undefined ? {} : { maxStates: request.query.maxStates }),
  };

  const query = findSolveGraphAlternativePaths(index, request.sourceId, request.targetId, queryOptions);
  const product = await createSolveGraphAlternativePathsProductBundle(
    sourceName,
    index,
    query,
    request.presentation,
  );

  if (product.graphId !== index.document.graphId
    || product.sourceId !== query.sourceId
    || product.targetId !== query.targetId
    || product.direction !== query.direction
    || product.execution.networkAccess !== false
    || product.execution.writeAccess !== false) {
    throw new Error("Solve Graph alternative-path query product identity changed during composition.");
  }

  return {
    schema: "solvelang.solve-graph.alternative-paths-query-product.v0",
    mode: "analyze-only",
    graphId: index.document.graphId,
    request: {
      sourceId: request.sourceId,
      targetId: request.targetId,
      direction: query.direction,
      ...(queryOptions.edgeKinds === undefined ? {} : { edgeKinds: [...queryOptions.edgeKinds] }),
      ...(queryOptions.maxDepth === undefined ? {} : { maxDepth: queryOptions.maxDepth }),
      ...(queryOptions.maxPaths === undefined ? {} : { maxPaths: queryOptions.maxPaths }),
      ...(queryOptions.maxStates === undefined ? {} : { maxStates: queryOptions.maxStates }),
      ...(request.presentation?.maxPaths === undefined ? {} : { presentationMaxPaths: request.presentation.maxPaths }),
    },
    query: cloneQueryResult(query),
    product,
    execution: {
      networkAccess: false,
      writeAccess: false,
    },
  };
}
