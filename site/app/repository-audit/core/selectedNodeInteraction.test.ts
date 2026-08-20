import assert from "node:assert/strict";
import test from "node:test";

import {
  createRepositorySelectedNodeIntelligenceRequestIdentity,
} from "./selectedNodeInteraction";
import type { RepositoryAuditVisualExplorer } from "./visualExplorer";
import type { RepositoryWorkflowPathEvidenceAnalysis } from "./workflowPathEvidence";

function explorer(graphId = "graph-current"): RepositoryAuditVisualExplorer {
  return {
    schema: "solvelang.repository-audit.visual-explorer.v0",
    mode: "analyze-only",
    graphId,
    status: "complete",
    nodes: [],
    edges: [],
    summary: {
      nodesObserved: 0,
      nodesShown: 0,
      nodesHidden: 0,
      edgesObserved: 0,
      edgesShown: 0,
      edgesHidden: 0,
      securityBoundaryNodesShown: 0,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxNodes: 100,
      maxEdges: 200,
      nodesTruncated: false,
      edgesTruncated: false,
      graphPartial: false,
    },
  };
}

function workflowEvidence(graphId = "graph-current"): RepositoryWorkflowPathEvidenceAnalysis {
  return {
    schema: "solvelang.repository-audit.workflow-path-evidence.v0",
    mode: "analyze-only",
    graphId,
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
    skipped: {
      missingText: 0,
      oversizedText: 0,
      dynamicReferences: 0,
      multilineReferences: 0,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxReferences: 250,
      maxWorkflowTextBytes: 512 * 1024,
      referencesTruncated: false,
      acceptedFiles: 3,
      workflowFilesExamined: 1,
      graphTruncated: false,
    },
  };
}

test("returns no selected-node request identity without a selection", () => {
  assert.equal(
    createRepositorySelectedNodeIntelligenceRequestIdentity(explorer(), workflowEvidence(), undefined),
    undefined,
  );
});

test("builds a deterministic request identity for equivalent bounded evidence", () => {
  const first = createRepositorySelectedNodeIntelligenceRequestIdentity(
    explorer(),
    workflowEvidence(),
    "node-current",
  );
  const second = createRepositorySelectedNodeIntelligenceRequestIdentity(
    structuredClone(explorer()),
    structuredClone(workflowEvidence()),
    "node-current",
  );

  assert.ok(first);
  assert.deepEqual(second, first);
  assert.equal(first.graphId, "graph-current");
  assert.equal(first.workflowGraphId, "graph-current");
  assert.equal(first.selectedNodeId, "node-current");
});

test("changes request identity when selection, graph, or bounded workflow evidence changes", () => {
  const baseline = createRepositorySelectedNodeIntelligenceRequestIdentity(
    explorer(),
    workflowEvidence(),
    "node-current",
  );
  assert.ok(baseline);

  const nextSelection = createRepositorySelectedNodeIntelligenceRequestIdentity(
    explorer(),
    workflowEvidence(),
    "node-next",
  );
  assert.notEqual(nextSelection?.key, baseline.key);

  const nextGraph = createRepositorySelectedNodeIntelligenceRequestIdentity(
    explorer("graph-next"),
    workflowEvidence("graph-next"),
    "node-current",
  );
  assert.notEqual(nextGraph?.key, baseline.key);

  const nextReference = workflowEvidence();
  nextReference.references[0].referenceId = "workflow-path:.github/workflows/test.yml:working-directory:8:src";
  assert.notEqual(
    createRepositorySelectedNodeIntelligenceRequestIdentity(explorer(), nextReference, "node-current")?.key,
    baseline.key,
  );

  const partialEvidence = workflowEvidence();
  partialEvidence.status = "partial";
  partialEvidence.skipped.dynamicReferences = 1;
  partialEvidence.execution.referencesTruncated = true;
  assert.notEqual(
    createRepositorySelectedNodeIntelligenceRequestIdentity(explorer(), partialEvidence, "node-current")?.key,
    baseline.key,
  );
});

test("length-prefixes request parts so structural boundaries remain unambiguous", () => {
  const left = workflowEvidence();
  left.references[0].referenceId = "a|1:b";
  const right = workflowEvidence();
  right.references[0].referenceId = "a";
  right.references.push({ ...right.references[0], referenceId: "1:b" });

  const leftIdentity = createRepositorySelectedNodeIntelligenceRequestIdentity(explorer(), left, "node-current");
  const rightIdentity = createRepositorySelectedNodeIntelligenceRequestIdentity(explorer(), right, "node-current");

  assert.ok(leftIdentity);
  assert.ok(rightIdentity);
  assert.notEqual(leftIdentity.key, rightIdentity.key);
});
