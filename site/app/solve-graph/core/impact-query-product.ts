import {
  createSolveGraphImpactExplanation,
  type SolveGraphImpactExplanation,
  type SolveGraphImpactExplanationOptions,
} from "./impact-explanation";
import {
  analyzeSolveGraphImpact,
  type SolveGraphQueryIndex,
  type SolveGraphTraversalOptions,
  type SolveGraphTraversalResult,
} from "./query-impact";

export type SolveGraphImpactQueryProductRequest = {
  changedNodeIds: readonly string[];
  query?: SolveGraphTraversalOptions;
  presentation?: SolveGraphImpactExplanationOptions;
};

export type SolveGraphImpactQueryProduct = {
  schema: "solvelang.solve-graph.impact-query-product.v0";
  mode: "analyze-only";
  graphId: string;
  request: {
    changedNodeIds: string[];
    edgeKinds?: SolveGraphTraversalOptions["edgeKinds"];
    maxDepth?: number;
    maxResults?: number;
    presentationMaxRows?: number;
  };
  query: SolveGraphTraversalResult;
  explanation: SolveGraphImpactExplanation;
  status: "complete" | "partial";
  execution: {
    networkAccess: false;
    writeAccess: false;
    queryTruncated: boolean;
    presentationTruncated: boolean;
  };
};

function cloneTraversalResult(result: SolveGraphTraversalResult): SolveGraphTraversalResult {
  return {
    direction: result.direction,
    roots: [...result.roots],
    entries: result.entries.map((entry) => ({ ...entry })),
    truncated: result.truncated,
    ...(result.truncationReason === undefined ? {} : { truncationReason: result.truncationReason }),
  };
}

function sameTextArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function createSolveGraphImpactQueryProduct(
  index: SolveGraphQueryIndex,
  request: SolveGraphImpactQueryProductRequest,
): SolveGraphImpactQueryProduct {
  const queryOptions: SolveGraphTraversalOptions = {
    ...(request.query?.edgeKinds === undefined ? {} : { edgeKinds: [...request.query.edgeKinds] }),
    ...(request.query?.maxDepth === undefined ? {} : { maxDepth: request.query.maxDepth }),
    ...(request.query?.maxResults === undefined ? {} : { maxResults: request.query.maxResults }),
  };
  const presentationOptions: SolveGraphImpactExplanationOptions = {
    ...(request.presentation?.maxRows === undefined ? {} : { maxRows: request.presentation.maxRows }),
  };

  const query = analyzeSolveGraphImpact(index, [...request.changedNodeIds], queryOptions);
  const explanation = createSolveGraphImpactExplanation(index, query, presentationOptions);
  const explanationRootIds = explanation.roots.map((root) => root.id);

  if (explanation.graphId !== index.document.graphId
    || explanation.direction !== query.direction
    || !sameTextArray(explanationRootIds, query.roots)
    || explanation.execution.queryTruncated !== query.truncated
    || explanation.execution.networkAccess !== false
    || explanation.execution.writeAccess !== false) {
    throw new Error("Solve Graph impact query product identity changed during composition.");
  }

  return {
    schema: "solvelang.solve-graph.impact-query-product.v0",
    mode: "analyze-only",
    graphId: index.document.graphId,
    request: {
      changedNodeIds: [...query.roots],
      ...(queryOptions.edgeKinds === undefined ? {} : { edgeKinds: [...queryOptions.edgeKinds] }),
      ...(queryOptions.maxDepth === undefined ? {} : { maxDepth: queryOptions.maxDepth }),
      ...(queryOptions.maxResults === undefined ? {} : { maxResults: queryOptions.maxResults }),
      ...(presentationOptions.maxRows === undefined ? {} : { presentationMaxRows: presentationOptions.maxRows }),
    },
    query: cloneTraversalResult(query),
    explanation,
    status: explanation.status,
    execution: {
      networkAccess: false,
      writeAccess: false,
      queryTruncated: explanation.execution.queryTruncated,
      presentationTruncated: explanation.execution.presentationTruncated,
    },
  };
}
