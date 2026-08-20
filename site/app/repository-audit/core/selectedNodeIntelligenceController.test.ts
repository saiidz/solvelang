import assert from "node:assert/strict";
import test from "node:test";

import type { RepositorySelectedNodeIntelligence } from "./selectedNodeIntelligence";
import type { RepositoryWorkflowPathEvidenceAnalysis } from "./workflowPathEvidence";
import {
  createRepositorySelectedNodeIntelligenceRequestKey,
  resolveRepositorySelectedNodeIntelligenceViewState,
} from "./selectedNodeIntelligenceController";

function product(graphId: string, selectedNodeId: string): RepositorySelectedNodeIntelligence {
  return { graphId, selectedNodeId } as RepositorySelectedNodeIntelligence;
}

function workflowEvidence(
  graphId: string,
  targetPath = "package-lock.json",
): RepositoryWorkflowPathEvidenceAnalysis {
  return {
    schema: "solvelang.repository-audit.workflow-path-evidence.v0",
    mode: "analyze-only",
    graphId,
    status: "complete",
    references: [{
      referenceId: `workflow-path:.github/workflows/ci.yml:cache-dependency-path:10:${targetPath}`,
      workflowPath: ".github/workflows/ci.yml",
      kind: "cache-dependency-path",
      rawReference: targetPath,
      targetPath,
      targetState: "present",
      evidence: { path: ".github/workflows/ci.yml", line: 10 },
    }],
    impacts: [{
      targetPath,
      workflows: [".github/workflows/ci.yml"],
      referenceKinds: ["cache-dependency-path"],
    }],
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

test("creates a deterministic compact request key only for an actionable selection", () => {
  const evidence = workflowEvidence("graph-a");
  const requestKey = createRepositorySelectedNodeIntelligenceRequestKey("graph-a", evidence, "node-a");

  assert.equal(
    requestKey,
    createRepositorySelectedNodeIntelligenceRequestKey("graph-a", { ...evidence }, "node-a"),
  );
  assert.match(requestKey ?? "", /^selected-intelligence:v1:[a-f0-9]{32}$/);
  assert.equal(createRepositorySelectedNodeIntelligenceRequestKey("graph-a", undefined, "node-a"), undefined);
  assert.equal(createRepositorySelectedNodeIntelligenceRequestKey("graph-a", evidence, undefined), undefined);
});

test("keeps request identity compact for a large accepted workflow target", () => {
  const evidence = workflowEvidence("graph-a", `packages/${"a".repeat(128 * 1024)}/package-lock.json`);
  const requestKey = createRepositorySelectedNodeIntelligenceRequestKey("graph-a", evidence, "node-a");

  assert.match(requestKey ?? "", /^selected-intelligence:v1:[a-f0-9]{32}$/);
  assert.ok((requestKey?.length ?? Number.POSITIVE_INFINITY) < 80);
});

test("changes request identity when bounded workflow evidence changes on the same graph and node", () => {
  const previousEvidence = workflowEvidence("graph-a", "package-lock.json");
  const currentEvidence = workflowEvidence("graph-a", "pnpm-lock.yaml");
  const previousRequestKey = createRepositorySelectedNodeIntelligenceRequestKey(
    "graph-a",
    previousEvidence,
    "node-a",
  );
  const currentRequestKey = createRepositorySelectedNodeIntelligenceRequestKey(
    "graph-a",
    currentEvidence,
    "node-a",
  );

  assert.notEqual(previousRequestKey, currentRequestKey);

  const view = resolveRepositorySelectedNodeIntelligenceViewState(
    "graph-a",
    "node-a",
    currentRequestKey,
    {
      requestKey: previousRequestKey ?? "",
      product: product("graph-a", "node-a"),
    },
  );

  assert.equal(view.pending, true);
  assert.equal(view.product, undefined);
  assert.equal(view.error, "");
});

test("changes request identity when workflow partial-truth metadata changes", () => {
  const previousEvidence = workflowEvidence("graph-a");
  const currentEvidence: RepositoryWorkflowPathEvidenceAnalysis = {
    ...previousEvidence,
    status: "partial",
    skipped: { ...previousEvidence.skipped, dynamicReferences: 1 },
  };

  assert.notEqual(
    createRepositorySelectedNodeIntelligenceRequestKey("graph-a", previousEvidence, "node-a"),
    createRepositorySelectedNodeIntelligenceRequestKey("graph-a", currentEvidence, "node-a"),
  );
});

test("treats a prior request result as pending after a rapid selection change", () => {
  const evidence = workflowEvidence("graph-a");
  const requestKey = createRepositorySelectedNodeIntelligenceRequestKey("graph-a", evidence, "node-b");
  const state = {
    requestKey: createRepositorySelectedNodeIntelligenceRequestKey("graph-a", evidence, "node-a") ?? "",
    product: product("graph-a", "node-a"),
  };

  const view = resolveRepositorySelectedNodeIntelligenceViewState("graph-a", "node-b", requestKey, state);

  assert.equal(view.pending, true);
  assert.equal(view.product, undefined);
  assert.equal(view.error, "");
});

test("never activates a product from another graph or selected node", () => {
  const requestKey = createRepositorySelectedNodeIntelligenceRequestKey(
    "graph-a",
    workflowEvidence("graph-a"),
    "node-a",
  ) ?? "";

  const wrongGraph = resolveRepositorySelectedNodeIntelligenceViewState(
    "graph-a",
    "node-a",
    requestKey,
    { requestKey, product: product("graph-b", "node-a") },
  );
  const wrongNode = resolveRepositorySelectedNodeIntelligenceViewState(
    "graph-a",
    "node-a",
    requestKey,
    { requestKey, product: product("graph-a", "node-b") },
  );

  assert.equal(wrongGraph.pending, false);
  assert.equal(wrongGraph.product, undefined);
  assert.equal(wrongNode.product, undefined);
});

test("activates only the exact current result and scopes errors to the current request", () => {
  const requestKey = createRepositorySelectedNodeIntelligenceRequestKey(
    "graph-a",
    workflowEvidence("graph-a"),
    "node-a",
  ) ?? "";
  const current = product("graph-a", "node-a");

  const success = resolveRepositorySelectedNodeIntelligenceViewState(
    "graph-a",
    "node-a",
    requestKey,
    { requestKey, product: current },
  );
  const error = resolveRepositorySelectedNodeIntelligenceViewState(
    "graph-a",
    "node-a",
    requestKey,
    { requestKey, error: "bounded composition failed" },
  );
  const cleared = resolveRepositorySelectedNodeIntelligenceViewState(
    "graph-a",
    undefined,
    undefined,
    { requestKey, product: current, error: "stale" },
  );

  assert.equal(success.pending, false);
  assert.equal(success.product, current);
  assert.equal(error.error, "bounded composition failed");
  assert.equal(cleared.pending, false);
  assert.equal(cleared.product, undefined);
  assert.equal(cleared.error, "");
});
