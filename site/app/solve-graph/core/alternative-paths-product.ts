import type { SolveGraphAlternativePathsResult } from "./alternative-paths";
import {
  createSolveGraphAlternativePathsDownload,
  type SolveGraphAlternativePathsDownload,
} from "./alternative-paths-artifact";
import {
  createSolveGraphAlternativePathsPresentation,
  type SolveGraphAlternativePathsPresentation,
  type SolveGraphAlternativePathsPresentationOptions,
} from "./alternative-paths-presentation";
import type { SolveGraphQueryIndex } from "./query-impact";

export type SolveGraphAlternativePathsProductBundle = {
  schema: "solvelang.solve-graph.alternative-paths-product.v0";
  mode: "analyze-only";
  graphId: string;
  direction: SolveGraphAlternativePathsResult["direction"];
  sourceId: string;
  targetId: string;
  status: "complete" | "partial";
  download: SolveGraphAlternativePathsDownload;
  presentation: SolveGraphAlternativePathsPresentation;
  execution: {
    networkAccess: false;
    writeAccess: false;
    queryTruncated: boolean;
    presentationRowsTruncated: boolean;
  };
};

export async function createSolveGraphAlternativePathsProductBundle(
  sourceName: string,
  index: SolveGraphQueryIndex,
  result: SolveGraphAlternativePathsResult,
  presentationOptions: SolveGraphAlternativePathsPresentationOptions = {},
): Promise<SolveGraphAlternativePathsProductBundle> {
  const [download, presentation] = await Promise.all([
    createSolveGraphAlternativePathsDownload(sourceName, index, result),
    Promise.resolve(createSolveGraphAlternativePathsPresentation(index, result, presentationOptions)),
  ]);

  if (download.artifact.execution.networkAccess !== false
    || download.artifact.execution.writeAccess !== false
    || presentation.execution.networkAccess !== false
    || presentation.execution.writeAccess !== false) {
    throw new Error("Solve Graph alternative-path product bundle requires capability-free outputs.");
  }

  if (download.artifact.graphId !== index.document.graphId
    || presentation.graphId !== index.document.graphId
    || download.artifact.graphId !== presentation.graphId
    || download.artifact.sourceId !== result.sourceId
    || download.artifact.targetId !== result.targetId
    || download.artifact.direction !== result.direction
    || presentation.sourceId !== result.sourceId
    || presentation.targetId !== result.targetId
    || presentation.direction !== result.direction
    || download.artifact.paths.length !== result.paths.length
    || presentation.summary.availablePaths !== result.paths.length) {
    throw new Error("Solve Graph alternative-path product bundle identity changed during composition.");
  }

  const queryTruncated = download.artifact.truncated;
  const presentationRowsTruncated = presentation.execution.presentationTruncated;

  return {
    schema: "solvelang.solve-graph.alternative-paths-product.v0",
    mode: "analyze-only",
    graphId: index.document.graphId,
    direction: result.direction,
    sourceId: result.sourceId,
    targetId: result.targetId,
    status: queryTruncated || presentationRowsTruncated ? "partial" : "complete",
    download,
    presentation,
    execution: {
      networkAccess: false,
      writeAccess: false,
      queryTruncated,
      presentationRowsTruncated,
    },
  };
}
