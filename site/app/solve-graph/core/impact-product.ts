import { createSolveGraphImpactDownload, type SolveGraphImpactDownload } from "./impact-artifact";
import { createSolveGraphImpactExplanation, type SolveGraphImpactExplanation } from "./impact-explanation";
import type { SolveGraphQueryIndex, SolveGraphTraversalResult } from "./query-impact";

export async function createSolveGraphImpactProductBundle(sourceName: string, index: SolveGraphQueryIndex, query: SolveGraphTraversalResult): Promise<{ schema: "solvelang.solve-graph.impact-product.v0"; mode: "analyze-only"; graphId: string; status: "complete" | "partial"; download: SolveGraphImpactDownload; presentation: SolveGraphImpactExplanation; execution: { networkAccess: false; writeAccess: false; queryTruncated: boolean; presentationTruncated: boolean } }> {
  const presentation = createSolveGraphImpactExplanation(index, query);
  const download = await createSolveGraphImpactDownload(sourceName, index, query);
  return { schema: "solvelang.solve-graph.impact-product.v0", mode: "analyze-only", graphId: index.document.graphId, status: presentation.status, download, presentation, execution: { networkAccess: false, writeAccess: false, queryTruncated: query.truncated, presentationTruncated: presentation.execution.presentationTruncated } };
}
