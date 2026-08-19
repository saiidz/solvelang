import type { SolveGraphDocument, SolveGraphNode } from "../../solve-graph/core/contracts";
import {
  analyzeSolveGraphImpact,
  createSolveGraphQueryIndex,
} from "../../solve-graph/core/query-impact";
import { normalizeRepositoryPath } from "./inventory";
import type {
  RepositoryWorkflowPathEvidenceAnalysis,
  RepositoryWorkflowPathReference,
} from "./workflowPathEvidence";

export type RepositoryAffectedTest = {
  testPath: string;
  nodeId: string;
  depth: number;
};

export type RepositoryAffectedWorkflow = {
  workflowPath: string;
  kind: RepositoryWorkflowPathReference["kind"];
  targetPath: string;
  evidence: { path: string; line: number };
};

export type RepositoryAffectedValidationEntry = {
  changedPath: string;
  graphState: "present" | "unresolved";
  tests: RepositoryAffectedTest[];
  workflows: RepositoryAffectedWorkflow[];
  traversalTruncated: boolean;
  testsTruncated: boolean;
  workflowsTruncated: boolean;
};

export type RepositoryAffectedValidationMap = {
  schema: "solvelang.repository-audit.affected-validation.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  summary: {
    changedPathsRequested: number;
    changedPathsAnalyzed: number;
    unresolvedChangedPaths: number;
    affectedTestFiles: number;
    affectedWorkflowFiles: number;
  };
  entries: RepositoryAffectedValidationEntry[];
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxChangedPaths: number;
    maxTestsPerPath: number;
    maxWorkflowsPerPath: number;
    maxDepth: number;
    maxTraversalResults: number;
    changedPathsTruncated: boolean;
    graphTruncated: boolean;
    workflowEvidencePartial: boolean;
    mappingsTruncated: boolean;
  };
};

export type RepositoryAffectedValidationOptions = {
  maxChangedPaths?: number;
  maxTestsPerPath?: number;
  maxWorkflowsPerPath?: number;
  maxDepth?: number;
  maxTraversalResults?: number;
};

const IMPACT_EDGE_KINDS = ["imports", "references", "depends-on", "tests", "triggers"] as const;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function isTestPath(path: string): boolean {
  const normalized = path.toLowerCase();
  const name = basename(normalized);
  const segments = normalized.split("/");
  if (segments.includes("__tests__") || segments.includes("tests") || segments.includes("test")) return true;
  if (/^test_.+\.(py|pyi)$/.test(name) || /.+_test\.(py|pyi)$/.test(name)) return true;
  return /(?:^|[._-])(test|spec)\.[^.]+$/.test(name);
}

function pathForNode(node: SolveGraphNode): string | undefined {
  const metadataPath = node.metadata?.path;
  if (typeof metadataPath === "string" && metadataPath.length > 0) return normalizeRepositoryPath(metadataPath);
  const evidencePath = node.evidence[0]?.path;
  return evidencePath ? normalizeRepositoryPath(evidencePath) : undefined;
}

function workflowReferenceAffectsPath(reference: RepositoryWorkflowPathReference, changedPath: string): boolean {
  if (reference.targetState !== "present") return false;
  if (reference.kind === "cache-dependency-path") return changedPath === reference.targetPath;
  return changedPath === reference.targetPath || changedPath.startsWith(`${reference.targetPath}/`);
}

function workflowEvidenceIsPartial(analysis: RepositoryWorkflowPathEvidenceAnalysis): boolean {
  return analysis.status === "partial"
    || analysis.execution.graphTruncated
    || analysis.execution.referencesTruncated
    || analysis.skipped.missingText > 0
    || analysis.skipped.oversizedText > 0
    || analysis.skipped.dynamicReferences > 0
    || analysis.skipped.multilineReferences > 0;
}

export async function createRepositoryAffectedValidationMap(
  graph: SolveGraphDocument,
  workflowEvidence: RepositoryWorkflowPathEvidenceAnalysis,
  changedPaths: readonly string[],
  options: RepositoryAffectedValidationOptions = {},
): Promise<RepositoryAffectedValidationMap> {
  if (changedPaths.length === 0) throw new Error("Repository affected-validation analysis requires at least one changed path.");

  const maxChangedPaths = boundedInteger(options.maxChangedPaths, 50, 1, 1_000, "Repository affected-validation maxChangedPaths");
  const maxTestsPerPath = boundedInteger(options.maxTestsPerPath, 100, 1, 1_000, "Repository affected-validation maxTestsPerPath");
  const maxWorkflowsPerPath = boundedInteger(options.maxWorkflowsPerPath, 100, 1, 1_000, "Repository affected-validation maxWorkflowsPerPath");
  const maxDepth = boundedInteger(options.maxDepth, 6, 0, 16, "Repository affected-validation maxDepth");
  const maxTraversalResults = boundedInteger(options.maxTraversalResults, 1_000, 1, 5_000, "Repository affected-validation maxTraversalResults");

  const index = await createSolveGraphQueryIndex(graph);
  if (workflowEvidence.graphId !== graph.graphId) {
    throw new Error("Repository affected-validation workflow evidence does not match the bounded Solve Graph.");
  }

  const nodesByPath = new Map<string, SolveGraphNode[]>();
  for (const node of graph.nodes) {
    const path = pathForNode(node);
    if (!path) continue;
    const current = nodesByPath.get(path) ?? [];
    current.push(node);
    nodesByPath.set(path, current);
  }
  for (const nodes of nodesByPath.values()) nodes.sort((left, right) => compareText(left.id, right.id));

  const normalizedChangedPaths = [...new Set(changedPaths.map((path) => normalizeRepositoryPath(path)))].sort(compareText);
  const changedPathsTruncated = normalizedChangedPaths.length > maxChangedPaths;
  const selectedChangedPaths = normalizedChangedPaths.slice(0, maxChangedPaths);
  const entries: RepositoryAffectedValidationEntry[] = [];

  for (const changedPath of selectedChangedPaths) {
    const roots = nodesByPath.get(changedPath) ?? [];
    if (roots.length === 0) {
      entries.push({
        changedPath,
        graphState: "unresolved",
        tests: [],
        workflows: [],
        traversalTruncated: false,
        testsTruncated: false,
        workflowsTruncated: false,
      });
      continue;
    }

    const traversal = analyzeSolveGraphImpact(index, roots.map((node) => node.id), {
      edgeKinds: [...IMPACT_EDGE_KINDS],
      maxDepth,
      maxResults: maxTraversalResults,
    });

    const testByPath = new Map<string, RepositoryAffectedTest>();
    for (const entry of traversal.entries) {
      if (entry.depth === 0) continue;
      const node = index.nodesById.get(entry.id);
      if (!node) continue;
      const path = pathForNode(node);
      if (!path || (node.kind !== "test" && !isTestPath(path))) continue;
      const existing = testByPath.get(path);
      if (!existing || entry.depth < existing.depth || (entry.depth === existing.depth && compareText(node.id, existing.nodeId) < 0)) {
        testByPath.set(path, { testPath: path, nodeId: node.id, depth: entry.depth });
      }
    }
    const allTests = [...testByPath.values()].sort((left, right) => left.depth - right.depth || compareText(left.testPath, right.testPath) || compareText(left.nodeId, right.nodeId));

    const workflowByKey = new Map<string, RepositoryAffectedWorkflow>();
    for (const reference of workflowEvidence.references) {
      if (!workflowReferenceAffectsPath(reference, changedPath)) continue;
      const key = `${reference.workflowPath}\u001f${reference.kind}\u001f${reference.targetPath}\u001f${reference.evidence.line}`;
      workflowByKey.set(key, {
        workflowPath: reference.workflowPath,
        kind: reference.kind,
        targetPath: reference.targetPath,
        evidence: { ...reference.evidence },
      });
    }
    const allWorkflows = [...workflowByKey.values()].sort((left, right) =>
      compareText(left.workflowPath, right.workflowPath)
      || compareText(left.kind, right.kind)
      || compareText(left.targetPath, right.targetPath)
      || left.evidence.line - right.evidence.line);

    entries.push({
      changedPath,
      graphState: "present",
      tests: allTests.slice(0, maxTestsPerPath),
      workflows: allWorkflows.slice(0, maxWorkflowsPerPath),
      traversalTruncated: traversal.truncated,
      testsTruncated: allTests.length > maxTestsPerPath,
      workflowsTruncated: allWorkflows.length > maxWorkflowsPerPath,
    });
  }

  const affectedTests = new Set(entries.flatMap((entry) => entry.tests.map((test) => test.testPath)));
  const affectedWorkflows = new Set(entries.flatMap((entry) => entry.workflows.map((workflow) => workflow.workflowPath)));
  const unresolvedChangedPaths = entries.filter((entry) => entry.graphState === "unresolved").length;
  const workflowEvidencePartial = workflowEvidenceIsPartial(workflowEvidence);
  const mappingsTruncated = entries.some((entry) => entry.traversalTruncated || entry.testsTruncated || entry.workflowsTruncated);
  const graphTruncated = graph.execution.truncated || graph.execution.status === "partial";
  const partial = graphTruncated
    || workflowEvidencePartial
    || changedPathsTruncated
    || mappingsTruncated
    || unresolvedChangedPaths > 0;

  return {
    schema: "solvelang.repository-audit.affected-validation.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: partial ? "partial" : "complete",
    summary: {
      changedPathsRequested: normalizedChangedPaths.length,
      changedPathsAnalyzed: entries.length,
      unresolvedChangedPaths,
      affectedTestFiles: affectedTests.size,
      affectedWorkflowFiles: affectedWorkflows.size,
    },
    entries,
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxChangedPaths,
      maxTestsPerPath,
      maxWorkflowsPerPath,
      maxDepth,
      maxTraversalResults,
      changedPathsTruncated,
      graphTruncated,
      workflowEvidencePartial,
      mappingsTruncated,
    },
  };
}
