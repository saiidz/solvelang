import assert from "node:assert/strict";
import test from "node:test";

import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "../../solve-graph/core/canonical";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import { createSolveGraphQueryIndex } from "../../solve-graph/core/query-impact";
import { createRepositorySelectedNodeValidationMap } from "./selectedNodeValidation";
import type { RepositoryWorkflowPathEvidenceAnalysis } from "./workflowPathEvidence";

async function fixture() {
  const core = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/core.ts",
    label: "core.ts",
    evidence: [{ kind: "deterministic-analysis", path: "src/core.ts" }],
    metadata: { path: "src/core.ts" },
  });
  const middle = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/middle.ts",
    label: "middle.ts",
    evidence: [{ kind: "deterministic-analysis", path: "src/middle.ts" }],
    metadata: { path: "src/middle.ts" },
  });
  const testNode = await createSolveGraphNode({
    kind: "file",
    identity: "file:tests/core.test.ts",
    label: "core.test.ts",
    evidence: [{ kind: "deterministic-analysis", path: "tests/core.test.ts" }],
    metadata: { path: "tests/core.test.ts" },
  });
  const edges = [
    await createSolveGraphEdge({
      kind: "imports",
      from: middle.id,
      to: core.id,
      evidence: [{ kind: "deterministic-analysis", path: "src/middle.ts" }],
    }),
    await createSolveGraphEdge({
      kind: "imports",
      from: testNode.id,
      to: middle.id,
      evidence: [{ kind: "deterministic-analysis", path: "tests/core.test.ts" }],
    }),
  ];
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    extractors: [{ id: "selected-validation-fixture", version: "1", deterministic: true }],
    nodes: [core, middle, testNode],
    edges,
  });
  const index = await createSolveGraphQueryIndex(document);
  const workflowEvidence: RepositoryWorkflowPathEvidenceAnalysis = {
    schema: "solvelang.repository-audit.workflow-path-evidence.v0",
    mode: "analyze-only",
    graphId: document.graphId,
    status: "complete",
    references: [
      {
        referenceId: "workflow-path:.github/workflows/ci.yml:working-directory:4:src",
        workflowPath: ".github/workflows/ci.yml",
        kind: "working-directory",
        rawReference: "src",
        targetPath: "src",
        targetState: "present",
        evidence: { path: ".github/workflows/ci.yml", line: 4 },
      },
      {
        referenceId: "workflow-path:.github/workflows/ci.yml:cache-dependency-path:8:src/core.ts",
        workflowPath: ".github/workflows/ci.yml",
        kind: "cache-dependency-path",
        rawReference: "src/core.ts",
        targetPath: "src/core.ts",
        targetState: "present",
        evidence: { path: ".github/workflows/ci.yml", line: 8 },
      },
    ],
    impacts: [],
    skipped: { missingText: 0, oversizedText: 0, dynamicReferences: 0, multilineReferences: 0 },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxReferences: 250,
      maxWorkflowTextBytes: 512 * 1024,
      referencesTruncated: false,
      acceptedFiles: document.nodes.length,
      workflowFilesExamined: 1,
      graphTruncated: false,
    },
  };

  return { core, document, index, workflowEvidence };
}

test("maps selected file nodes to bounded affected tests and workflows", async () => {
  const { core, index, workflowEvidence } = await fixture();
  const result = await createRepositorySelectedNodeValidationMap(index, workflowEvidence, core.id, {
    maxDepth: 4,
    maxTraversalResults: 50,
    maxTestsPerPath: 10,
    maxWorkflowsPerPath: 10,
  });

  assert.ok(result);
  assert.equal(result.status, "complete");
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].changedPath, "src/core.ts");
  assert.deepEqual(result.entries[0].tests.map((entry) => [entry.testPath, entry.depth]), [
    ["tests/core.test.ts", 2],
  ]);
  assert.deepEqual(result.entries[0].workflows.map((entry) => [entry.kind, entry.targetPath]), [
    ["cache-dependency-path", "src/core.ts"],
    ["working-directory", "src"],
  ]);
  assert.equal(result.execution.maxChangedPaths, 1);
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
});

test("returns no mapping for an empty or stale selected node", async () => {
  const { index, workflowEvidence } = await fixture();

  assert.equal(await createRepositorySelectedNodeValidationMap(index, workflowEvidence, undefined), undefined);
  assert.equal(await createRepositorySelectedNodeValidationMap(index, workflowEvidence, "node-from-previous-scan"), undefined);
});

test("rejects workflow evidence from a different graph", async () => {
  const { core, index, workflowEvidence } = await fixture();
  const mismatched = structuredClone(workflowEvidence);
  mismatched.graphId = "sg_00000000000000000000000000000000";

  await assert.rejects(
    createRepositorySelectedNodeValidationMap(index, mismatched, core.id),
    /workflow evidence must match the impact graph/,
  );
});
