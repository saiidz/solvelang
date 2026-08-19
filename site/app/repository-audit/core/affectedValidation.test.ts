import assert from "node:assert/strict";
import test from "node:test";
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "../../solve-graph/core/canonical";
import type { SolveGraphDocument, SolveGraphNode } from "../../solve-graph/core/contracts";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import { createRepositoryAffectedValidationMap } from "./affectedValidation";
import type { RepositoryWorkflowPathEvidenceAnalysis } from "./workflowPathEvidence";

async function fileNode(path: string): Promise<SolveGraphNode> {
  return createSolveGraphNode({
    kind: "file",
    identity: `file:${path}`,
    label: path.slice(path.lastIndexOf("/") + 1),
    evidence: [{ kind: "deterministic-analysis", path }],
    metadata: { path },
  });
}

async function graphWithImports(
  paths: string[],
  imports: Array<[fromPath: string, toPath: string]>,
  partial = false,
): Promise<SolveGraphDocument> {
  const nodes = await Promise.all(paths.map(fileNode));
  const byPath = new Map(nodes.map((node) => [node.metadata?.path as string, node]));
  const edges = await Promise.all(imports.map(async ([fromPath, toPath]) => {
    const from = byPath.get(fromPath);
    const to = byPath.get(toPath);
    if (!from || !to) throw new Error(`Missing fixture node for ${fromPath} -> ${toPath}`);
    return createSolveGraphEdge({
      kind: "imports",
      from: from.id,
      to: to.id,
      evidence: [{ kind: "deterministic-analysis", path: fromPath }],
    });
  }));
  return createSolveGraphDocument({
    source: solveGraphFixtureSource,
    extractors: [{ id: "fixture-imports", version: "1.0.0", deterministic: true }],
    ...(partial ? { status: "partial" as const, truncationReasons: ["file-count" as const] } : {}),
    nodes,
    edges,
  });
}

function workflowEvidence(
  graph: SolveGraphDocument,
  references: RepositoryWorkflowPathEvidenceAnalysis["references"],
  overrides: Partial<RepositoryWorkflowPathEvidenceAnalysis> = {},
): RepositoryWorkflowPathEvidenceAnalysis {
  return {
    schema: "solvelang.repository-audit.workflow-path-evidence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: "complete",
    references,
    impacts: [],
    skipped: { missingText: 0, oversizedText: 0, dynamicReferences: 0, multilineReferences: 0 },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxReferences: 250,
      maxWorkflowTextBytes: 512 * 1024,
      referencesTruncated: false,
      acceptedFiles: graph.nodes.length,
      workflowFilesExamined: 1,
      graphTruncated: graph.execution.truncated,
    },
    ...overrides,
  };
}

function workingDirectoryReference(workflowPath: string, targetPath: string, line = 4) {
  return {
    referenceId: `workflow-path:${workflowPath}:working-directory:${line}:${targetPath}`,
    workflowPath,
    kind: "working-directory" as const,
    rawReference: targetPath,
    targetPath,
    targetState: "present" as const,
    evidence: { path: workflowPath, line },
  };
}

function cacheReference(workflowPath: string, targetPath: string, line = 8) {
  return {
    referenceId: `workflow-path:${workflowPath}:cache-dependency-path:${line}:${targetPath}`,
    workflowPath,
    kind: "cache-dependency-path" as const,
    rawReference: targetPath,
    targetPath,
    targetState: "present" as const,
    evidence: { path: workflowPath, line },
  };
}

test("maps transitive affected tests and repository-local workflow path evidence", async () => {
  const graph = await graphWithImports(
    ["src/core.ts", "src/middle.ts", "tests/core.test.ts"],
    [["src/middle.ts", "src/core.ts"], ["tests/core.test.ts", "src/middle.ts"]],
  );
  const workflow = workflowEvidence(graph, [
    workingDirectoryReference(".github/workflows/ci.yml", "src"),
    cacheReference(".github/workflows/ci.yml", "src/core.ts"),
  ]);

  const analysis = await createRepositoryAffectedValidationMap(graph, workflow, ["src/core.ts"]);

  assert.equal(analysis.status, "complete");
  assert.equal(analysis.summary.affectedTestFiles, 1);
  assert.equal(analysis.summary.affectedWorkflowFiles, 1);
  assert.equal(analysis.entries.length, 1);
  assert.equal(analysis.entries[0].graphState, "present");
  assert.deepEqual(analysis.entries[0].tests.map((item) => [item.testPath, item.depth]), [
    ["tests/core.test.ts", 2],
  ]);
  assert.deepEqual(analysis.entries[0].workflows.map((item) => [item.workflowPath, item.kind, item.targetPath]), [
    [".github/workflows/ci.yml", "cache-dependency-path", "src/core.ts"],
    [".github/workflows/ci.yml", "working-directory", "src"],
  ]);
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);
});

test("bounds affected test and workflow mappings deterministically", async () => {
  const graph = await graphWithImports(
    ["src/core.ts", "tests/a.test.ts", "tests/b.test.ts"],
    [["tests/a.test.ts", "src/core.ts"], ["tests/b.test.ts", "src/core.ts"]],
  );
  const workflow = workflowEvidence(graph, [
    workingDirectoryReference(".github/workflows/a.yml", "src"),
    workingDirectoryReference(".github/workflows/b.yml", "src"),
  ]);

  const analysis = await createRepositoryAffectedValidationMap(graph, workflow, ["src/core.ts"], {
    maxTestsPerPath: 1,
    maxWorkflowsPerPath: 1,
  });

  assert.equal(analysis.status, "partial");
  assert.equal(analysis.execution.mappingsTruncated, true);
  assert.equal(analysis.entries[0].testsTruncated, true);
  assert.equal(analysis.entries[0].workflowsTruncated, true);
  assert.deepEqual(analysis.entries[0].tests.map((item) => item.testPath), ["tests/a.test.ts"]);
  assert.deepEqual(analysis.entries[0].workflows.map((item) => item.workflowPath), [".github/workflows/a.yml"]);
});

test("reports unresolved or incomplete evidence conservatively and rejects mismatched integrity", async () => {
  const graph = await graphWithImports(["src/core.ts", "tests/core.test.ts"], [["tests/core.test.ts", "src/core.ts"]]);
  const incompleteWorkflow = workflowEvidence(graph, [], {
    skipped: { missingText: 0, oversizedText: 0, dynamicReferences: 1, multilineReferences: 0 },
  });

  const analysis = await createRepositoryAffectedValidationMap(graph, incompleteWorkflow, ["missing.ts", "src/core.ts"]);
  assert.equal(analysis.status, "partial");
  assert.equal(analysis.summary.unresolvedChangedPaths, 1);
  assert.equal(analysis.execution.workflowEvidencePartial, true);
  assert.deepEqual(analysis.entries.map((entry) => [entry.changedPath, entry.graphState]), [
    ["missing.ts", "unresolved"],
    ["src/core.ts", "present"],
  ]);

  const mismatchedWorkflow = workflowEvidence(graph, []);
  mismatchedWorkflow.graphId = "sg_00000000000000000000000000000000";
  await assert.rejects(
    createRepositoryAffectedValidationMap(graph, mismatchedWorkflow, ["src/core.ts"]),
    /workflow evidence does not match/,
  );

  const tampered = structuredClone(graph);
  tampered.nodes[0].label = "tampered";
  await assert.rejects(
    createRepositoryAffectedValidationMap(tampered, workflowEvidence(graph, []), ["src/core.ts"]),
    /integrity-valid/,
  );

  await assert.rejects(
    createRepositoryAffectedValidationMap(graph, workflowEvidence(graph, []), []),
    /requires at least one changed path/,
  );
});

test("marks bounded graph evidence partial even when mapped entries are available", async () => {
  const graph = await graphWithImports(
    ["src/core.ts", "tests/core.test.ts"],
    [["tests/core.test.ts", "src/core.ts"]],
    true,
  );
  const workflow = workflowEvidence(graph, [], { status: "partial" });

  const analysis = await createRepositoryAffectedValidationMap(graph, workflow, ["src/core.ts"]);
  assert.equal(analysis.status, "partial");
  assert.equal(analysis.execution.graphTruncated, true);
  assert.equal(analysis.entries[0].tests[0].testPath, "tests/core.test.ts");
});
