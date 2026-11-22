import type { RepositorySnapshot } from "../../repository-audit/core/inventory";
import {
  extractRepositoryDependencyGraph as extractJavaScriptDependencyGraph,
  type ExtractRepositoryDependencyGraphOptions,
} from "./import-extractor";
import { augmentSolveGraphWithBladeDirectives } from "./blade-directive-extractor";
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
  const phpGraph = await augmentSolveGraphWithPhpLocalImports(pythonGraph, snapshot);
  return augmentSolveGraphWithBladeDirectives(phpGraph, snapshot);
}
