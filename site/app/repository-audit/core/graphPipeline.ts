import type { SolveGraphDocument, SolveGraphScanLimits } from "../../solve-graph/core/contracts";
import { extractRepositoryMultiLanguageDependencyGraph } from "../../solve-graph/core/dependency-extractor";
import {
  createRepositoryGraphIntelligence,
  type RepositoryGraphIntelligence,
  type RepositoryGraphIntelligenceOptions,
} from "./graphIntelligence";
import type { RepositorySnapshot } from "./inventory";

export type RepositoryAuditGraphPipelineOptions = {
  graphLimits?: SolveGraphScanLimits;
  intelligence?: RepositoryGraphIntelligenceOptions;
  privateSource?: boolean;
};

export type RepositoryAuditGraphPipelineResult = {
  schema: "solvelang.repository-audit.graph-pipeline.v0";
  mode: "analyze-only";
  graph: SolveGraphDocument;
  intelligence: RepositoryGraphIntelligence;
  execution: {
    status: SolveGraphDocument["execution"]["status"];
    truncated: boolean;
    truncationReasons: SolveGraphDocument["execution"]["truncationReasons"];
    networkAccess: false;
    writeAccess: false;
  };
};

export async function analyzeRepositoryGraph(
  snapshot: RepositorySnapshot,
  options: RepositoryAuditGraphPipelineOptions = {},
): Promise<RepositoryAuditGraphPipelineResult> {
  const graph = await extractRepositoryMultiLanguageDependencyGraph(snapshot, {
    ...(options.graphLimits ? { limits: options.graphLimits } : {}),
    privateSource: options.privateSource ?? true,
  });

  if (graph.source.fingerprint !== snapshot.source.fingerprint || graph.source.revision !== snapshot.source.revision) {
    throw new Error("Repository Audit graph source does not match the analyzed snapshot.");
  }

  const intelligence = await createRepositoryGraphIntelligence(graph, options.intelligence);
  if (intelligence.graphId !== graph.graphId) {
    throw new Error("Repository Audit graph intelligence does not match the extracted graph.");
  }

  return {
    schema: "solvelang.repository-audit.graph-pipeline.v0",
    mode: "analyze-only",
    graph,
    intelligence,
    execution: {
      status: graph.execution.status,
      truncated: graph.execution.truncated,
      truncationReasons: [...graph.execution.truncationReasons],
      networkAccess: false,
      writeAccess: false,
    },
  };
}
