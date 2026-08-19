import type { RepositorySnapshot } from "../../repository-audit/core/inventory";
import {
  extractRepositoryDependencyGraph as extractJavaScriptDependencyGraph,
  type ExtractRepositoryDependencyGraphOptions,
} from "./import-extractor";
import { augmentSolveGraphWithPhpLocalImports } from "./php-import-extractor";
import { augmentSolveGraphWithPythonImports } from "./python-import-extractor";
import type { SolveGraphDocument } from "./contracts";

export type ExtractRepositoryMultiLanguageDependencyGraphOptions = ExtractRepositoryDependencyGraphOptions;

export async function extractRepositoryMultiLanguageDependencyGraph(
  snapshot: RepositorySnapshot,
  options: ExtractRepositoryMultiLanguageDependencyGraphOptions = {},
): Promise<SolveGraphDocument> {
  const javaScriptGraph = await extractJavaScriptDependencyGraph(snapshot, options);
  const pythonGraph = await augmentSolveGraphWithPythonImports(javaScriptGraph, snapshot);
  return augmentSolveGraphWithPhpLocalImports(pythonGraph, snapshot);
}
