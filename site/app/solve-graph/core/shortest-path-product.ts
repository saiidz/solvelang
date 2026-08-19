import type { SolveGraphQueryIndex } from "./query-impact";
import type { SolveGraphShortestPathResult } from "./shortest-path";
import {
  createSolveGraphShortestPathDownload,
  type SolveGraphShortestPathDownload,
} from "./shortest-path-artifact";
import {
  createSolveGraphShortestPathPresentation,
  type SolveGraphShortestPathPresentation,
} from "./shortest-path-presentation";

export type SolveGraphShortestPathProductBundle = {
  schema: "solvelang.solve-graph.shortest-path-product.v0";
  mode: "analyze-only";
  graphId: string;
  direction: SolveGraphShortestPathResult["direction"];
  sourceId: string;
  targetId: string;
  found: boolean;
  status: "complete" | "partial";
  download: SolveGraphShortestPathDownload;
  presentation: SolveGraphShortestPathPresentation;
  execution: {
    networkAccess: false;
    writeAccess: false;
    queryTruncated: boolean;
  };
};

export async function createSolveGraphShortestPathProductBundle(
  sourceName: string,
  index: SolveGraphQueryIndex,
  result: SolveGraphShortestPathResult,
): Promise<SolveGraphShortestPathProductBundle> {
  const presentation = createSolveGraphShortestPathPresentation(index, result);
  const download = await createSolveGraphShortestPathDownload(sourceName, index, result);

  if (download.artifact.execution.networkAccess !== false
    || download.artifact.execution.writeAccess !== false
    || presentation.execution.networkAccess !== false
    || presentation.execution.writeAccess !== false) {
    throw new Error("Solve Graph shortest-path product bundle requires capability-free outputs.");
  }

  if (download.artifact.graphId !== index.document.graphId
    || presentation.graphId !== index.document.graphId
    || download.artifact.graphId !== presentation.graphId
    || download.artifact.sourceId !== result.sourceId
    || download.artifact.targetId !== result.targetId
    || download.artifact.direction !== result.direction
    || download.artifact.found !== result.found
    || presentation.sourceId !== result.sourceId
    || presentation.targetId !== result.targetId
    || presentation.direction !== result.direction
    || presentation.found !== result.found
    || download.artifact.nodeIds.length !== result.nodeIds.length
    || download.artifact.hops.length !== result.hops.length
    || presentation.nodes.length !== result.nodeIds.length
    || presentation.hops.length !== result.hops.length
    || download.artifact.truncated !== result.truncated
    || presentation.execution.queryTruncated !== result.truncated) {
    throw new Error("Solve Graph shortest-path product bundle identity changed during composition.");
  }

  const queryTruncated = result.truncated;
  return {
    schema: "solvelang.solve-graph.shortest-path-product.v0",
    mode: "analyze-only",
    graphId: index.document.graphId,
    direction: result.direction,
    sourceId: result.sourceId,
    targetId: result.targetId,
    found: result.found,
    status: queryTruncated ? "partial" : "complete",
    download,
    presentation,
    execution: {
      networkAccess: false,
      writeAccess: false,
      queryTruncated,
    },
  };
}
