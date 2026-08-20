import assert from "node:assert/strict";
import test from "node:test";

import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "../../solve-graph/core/canonical";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import { createSolveGraphQueryIndex } from "../../solve-graph/core/query-impact";
import { createRepositorySelectedNodeIntelligence } from "./selectedNodeIntelligence";
import { createRepositoryAuditVisualExplorer } from "./visualExplorer";
import type { RepositoryWorkflowPathEvidenceAnalysis } from "./workflowPathEvidence";

async function fixture() {
  const changed = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/core.ts",
    label: "core.ts",
    evidence: [{ kind: "deterministic-analysis", path: "src/core.ts" }],
    metadata: { path: "src/core.ts" },
  });
  const testNode = await createSolveGraphNode({
    kind: "file",
    identity: "file:tests/core.test.ts",
    label: "core.test.ts",
    evidence: [{ kind: "deterministic-analysis", path: "tests/core.test.ts" }],
    metadata: { path: "tests/core.test.ts" },
  });
  const edge = await createSolveGraphEdge({
    kind: "imports",
    from: testNode.id,
    to: changed.id,
    evidence: [{ kind: "deterministic-analysis", path: "tests/core.test.ts" }],
  });
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    extractors: [{ id: "selected-intelligence-fixture", version: "1", deterministic: true }],
    nodes: [changed, testNode],
    edges: [edge],
  });
  const index = await createSolveGraphQueryIndex(document);
  const explorer = await createRepositoryAuditVisualExplorer(document);
  const workflowEvidence: RepositoryWorkflowPathEvidenceAnalysis = {
    schema: "solvelang.repository-audit.workflow-path-evidence.v0",
    mode: "analyze-only",
    graphId: document.graphId,
    status: "complete",
    references: [{
      referenceId: "workflow-path:.github/workflows/ci.yml:working-directory:4:src",
      workflowPath: ".github/workflows/ci.yml",
      kind: "working-directory",
      rawReference: "src",
      targetPath: "src",
      targetState: "present",
      evidence: { path: ".github/workflows/ci.yml", line: 4 },
    }],
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
  return { changed, explorer, index, workflowEvidence };
}

test("composes selected-node impact and affected validation into one bounded product", async () => {
  const { changed, explorer, index, workflowEvidence } = await fixture();
  const result = await createRepositorySelectedNodeIntelligence(
    explorer,
    index,
    workflowEvidence,
    changed.id,
    {
      impact: { maxDepth: 4, maxResults: 20, maxRows: 10 },
      validation: { maxDepth: 4, maxTraversalResults: 20, maxTestsPerPath: 10, maxWorkflowsPerPath: 10 },
    },
  );

  assert.ok(result);
  assert.equal(result.schema, "solvelang.repository-audit.selected-node-intelligence.v0");
  assert.equal(result.mode, "analyze-only");
  assert.equal(result.graphId, explorer.graphId);
  assert.equal(result.selectedNodeId, changed.id);
  assert.equal(result.impact.query.entries.some((entry) => entry.depth === 1), true);
  assert.equal(result.validation?.entries[0].changedPath, "src/core.ts");
  assert.deepEqual(result.validation?.entries[0].tests.map((entry) => entry.testPath), ["tests/core.test.ts"]);
  assert.deepEqual(result.validation?.entries[0].workflows.map((entry) => entry.workflowPath), [".github/workflows/ci.yml"]);
  assert.equal(result.execution.validationAvailable, true);
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
});

test("returns no selected-node product for empty or stale selections", async () => {
  const { explorer, index, workflowEvidence } = await fixture();

  assert.equal(await createRepositorySelectedNodeIntelligence(explorer, index, workflowEvidence, undefined), undefined);
  assert.equal(await createRepositorySelectedNodeIntelligence(explorer, index, workflowEvidence, "node-from-previous-scan"), undefined);
});

test("propagates validation partial truth independently from impact bounds", async () => {
  const { changed, explorer, index, workflowEvidence } = await fixture();
  const partialWorkflow = structuredClone(workflowEvidence);
  partialWorkflow.status = "partial";
  partialWorkflow.skipped.dynamicReferences = 1;

  const result = await createRepositorySelectedNodeIntelligence(explorer, index, partialWorkflow, changed.id);

  assert.ok(result);
  assert.equal(result.status, "partial");
  assert.equal(result.execution.validationAvailable, true);
  assert.equal(result.execution.validationPartial, true);
  assert.equal(result.execution.impactQueryTruncated, false);
});
