import assert from "node:assert/strict";
import test from "node:test";

import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphImpactExplanation } from "./impact-explanation";
import { analyzeSolveGraphImpact, createSolveGraphQueryIndex } from "./query-impact";

async function fixture() {
  const root = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/root.ts",
    label: "root.ts",
    evidence: [{ kind: "parser", path: "src/root.ts" }],
    metadata: { path: "src/root.ts" },
  });
  const direct = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/direct.ts",
    label: "direct.ts",
    evidence: [{ kind: "parser", path: "src/direct.ts" }],
    metadata: { path: "src/direct.ts" },
  });
  const transitive = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/transitive.ts",
    label: "transitive.ts",
    evidence: [{ kind: "parser", path: "src/transitive.ts" }],
    metadata: { path: "src/transitive.ts" },
  });
  const sibling = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/sibling.ts",
    label: "sibling.ts",
    evidence: [{ kind: "parser", path: "src/sibling.ts" }],
    metadata: { path: "src/sibling.ts" },
  });

  const directEdge = await createSolveGraphEdge({
    kind: "imports",
    from: direct.id,
    to: root.id,
    evidence: [{ kind: "parser", path: "src/direct.ts" }],
  });
  const transitiveEdge = await createSolveGraphEdge({
    kind: "calls",
    from: transitive.id,
    to: direct.id,
    evidence: [{ kind: "parser", path: "src/transitive.ts" }],
  });
  const siblingEdge = await createSolveGraphEdge({
    kind: "references",
    from: sibling.id,
    to: root.id,
    evidence: [{ kind: "parser", path: "src/sibling.ts" }],
  });

  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "impact-explanation-fixture", version: "1", deterministic: true }],
    nodes: [transitive, sibling, root, direct],
    edges: [transitiveEdge, siblingEdge, directEdge],
  });
  return {
    index: await createSolveGraphQueryIndex(document),
    root,
    direct,
    transitive,
    sibling,
  };
}

test("explains deterministic dependent impact paths", async () => {
  const { index, root, direct, transitive, sibling } = await fixture();
  const result = analyzeSolveGraphImpact(index, [root.id]);

  const first = createSolveGraphImpactExplanation(index, result);
  const second = createSolveGraphImpactExplanation(index, structuredClone(result));

  assert.deepEqual(first, second);
  assert.equal(first.status, "complete");
  assert.equal(first.headline, "3 impacted nodes observed");
  assert.equal(first.summary.impactedNodes, 3);
  assert.equal(first.summary.maximumObservedDepth, 2);
  assert.deepEqual(first.rows.map((row) => row.node.id), [direct.id, sibling.id, transitive.id]);
  assert.deepEqual(first.rows.find((row) => row.node.id === transitive.id)!.steps.map((step) => step.sentence), [
    "direct.ts --imports--> root.ts",
    "transitive.ts --calls--> direct.ts",
  ]);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
});

test("preserves bounded depth uncertainty without claiming absence", async () => {
  const { index, root } = await fixture();
  const result = analyzeSolveGraphImpact(index, [root.id], { maxDepth: 1 });
  const explanation = createSolveGraphImpactExplanation(index, result);

  assert.equal(explanation.status, "partial");
  assert.equal(explanation.execution.queryTruncated, true);
  assert.equal(explanation.summary.impactedNodes, 2);
  assert.match(explanation.headline, /partial/);
  assert.match(explanation.detail, /additional impacted nodes may exist/);
  assert.match(explanation.notices.join(" "), /depth bound/);
});

test("keeps presentation truncation distinct from query truncation", async () => {
  const { index, root } = await fixture();
  const result = analyzeSolveGraphImpact(index, [root.id]);
  const explanation = createSolveGraphImpactExplanation(index, result, { maxRows: 1 });

  assert.equal(explanation.status, "partial");
  assert.equal(explanation.execution.queryTruncated, false);
  assert.equal(explanation.execution.presentationTruncated, true);
  assert.equal(explanation.summary.impactedNodes, 3);
  assert.equal(explanation.summary.explainedNodes, 1);
  assert.equal(explanation.summary.hiddenNodes, 2);
  assert.match(explanation.detail, /shows 1 and hides 2/);
});

test("reports complete no-impact truth when the configured graph scope is exhausted", async () => {
  const { index, transitive } = await fixture();
  const result = analyzeSolveGraphImpact(index, [transitive.id]);
  const explanation = createSolveGraphImpactExplanation(index, result);

  assert.equal(explanation.status, "complete");
  assert.equal(explanation.summary.impactedNodes, 0);
  assert.equal(explanation.rows.length, 0);
  assert.equal(explanation.headline, "No impacted dependent nodes found");
  assert.match(explanation.detail, /completely searched configured graph scope/);
});

test("rejects tampered parent and edge traversal evidence", async () => {
  const { index, root, transitive } = await fixture();
  const result = analyzeSolveGraphImpact(index, [root.id]);

  const badParent = structuredClone(result);
  const transitiveEntry = badParent.entries.find((entry) => entry.id === transitive.id)!;
  transitiveEntry.parentId = root.id;
  assert.throws(
    () => createSolveGraphImpactExplanation(index, badParent),
    /parent chain is invalid/,
  );

  const badEdge = structuredClone(result);
  badEdge.entries.find((entry) => entry.depth === 1)!.viaEdgeId = "sge_missing";
  assert.throws(
    () => createSolveGraphImpactExplanation(index, badEdge),
    /edge traversal is invalid/,
  );
});
