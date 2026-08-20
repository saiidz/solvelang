import assert from "node:assert/strict";
import test from "node:test";

import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphImpactQueryProduct } from "./impact-query-product";
import { createSolveGraphQueryIndex } from "./query-impact";

async function fixture() {
  const root = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/root.ts",
    label: "root.ts",
    evidence: [{ kind: "parser", path: "src/root.ts" }],
  });
  const middle = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/middle.ts",
    label: "middle.ts",
    evidence: [{ kind: "parser", path: "src/middle.ts" }],
  });
  const leaf = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/leaf.ts",
    label: "leaf.ts",
    evidence: [{ kind: "parser", path: "src/leaf.ts" }],
  });
  const first = await createSolveGraphEdge({
    kind: "imports",
    from: middle.id,
    to: root.id,
    evidence: [{ kind: "parser", path: "src/middle.ts" }],
  });
  const second = await createSolveGraphEdge({
    kind: "calls",
    from: leaf.id,
    to: middle.id,
    evidence: [{ kind: "parser", path: "src/leaf.ts" }],
  });
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "impact-query-product-fixture", version: "1", deterministic: true }],
    nodes: [leaf, root, middle],
    edges: [second, first],
  });
  return { index: await createSolveGraphQueryIndex(document), root, middle, leaf };
}

test("composes one deterministic dependent-impact query and explanation", async () => {
  const { index, root, middle, leaf } = await fixture();
  const request = {
    changedNodeIds: [root.id],
    query: { edgeKinds: ["imports", "calls"] as const, maxDepth: 4, maxResults: 100 },
    presentation: { maxRows: 100 },
  };

  const first = createSolveGraphImpactQueryProduct(index, request);
  const second = createSolveGraphImpactQueryProduct(index, structuredClone(request));

  assert.deepEqual(first, second);
  assert.equal(first.graphId, index.document.graphId);
  assert.deepEqual(first.request.changedNodeIds, [root.id]);
  assert.equal(first.query.direction, "dependents");
  assert.deepEqual(first.query.entries.map((entry) => entry.id), [root.id, middle.id, leaf.id]);
  assert.equal(first.explanation.summary.impactedNodes, 2);
  assert.equal(first.explanation.summary.explainedNodes, 2);
  assert.equal(first.status, "complete");
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
});

test("detaches canonical request evidence from caller mutation", async () => {
  const { index, root } = await fixture();
  const changedNodeIds = [root.id, root.id];
  const edgeKinds: Array<"imports" | "calls"> = ["imports", "calls"];
  const request = {
    changedNodeIds,
    query: { edgeKinds, maxDepth: 3, maxResults: 50 },
    presentation: { maxRows: 20 },
  };
  const product = createSolveGraphImpactQueryProduct(index, request);

  changedNodeIds.length = 0;
  edgeKinds.length = 0;
  request.query.maxResults = 1;
  request.presentation.maxRows = 1;

  assert.deepEqual(product.request.changedNodeIds, [root.id]);
  assert.deepEqual(product.request.edgeKinds, ["imports", "calls"]);
  assert.equal(product.request.maxResults, 50);
  assert.equal(product.request.presentationMaxRows, 20);
  assert.equal(product.explanation.summary.impactedNodes, 2);
});

test("keeps query truncation explicit when the bounded impact traversal stops", async () => {
  const { index, root } = await fixture();
  const product = createSolveGraphImpactQueryProduct(index, {
    changedNodeIds: [root.id],
    query: { maxDepth: 0 },
  });

  assert.equal(product.query.truncated, true);
  assert.equal(product.query.truncationReason, "depth");
  assert.equal(product.explanation.summary.impactedNodes, 0);
  assert.equal(product.status, "partial");
  assert.equal(product.execution.queryTruncated, true);
  assert.equal(product.execution.presentationTruncated, false);
  assert.match(product.explanation.detail, /absence is not proven/i);
});

test("keeps presentation truncation separate from a complete impact traversal", async () => {
  const { index, root } = await fixture();
  const product = createSolveGraphImpactQueryProduct(index, {
    changedNodeIds: [root.id],
    query: { maxDepth: 4, maxResults: 100 },
    presentation: { maxRows: 1 },
  });

  assert.equal(product.query.truncated, false);
  assert.equal(product.explanation.summary.impactedNodes, 2);
  assert.equal(product.explanation.summary.explainedNodes, 1);
  assert.equal(product.explanation.summary.hiddenNodes, 1);
  assert.equal(product.status, "partial");
  assert.equal(product.execution.queryTruncated, false);
  assert.equal(product.execution.presentationTruncated, true);
});

test("fails closed on missing roots and invalid query or presentation bounds", async () => {
  const { index, root } = await fixture();

  assert.throws(
    () => createSolveGraphImpactQueryProduct(index, { changedNodeIds: ["sgn_missing"] }),
    /root does not exist/,
  );
  assert.throws(
    () => createSolveGraphImpactQueryProduct(index, { changedNodeIds: [root.id], query: { maxResults: 0 } }),
    /maxResults/,
  );
  assert.throws(
    () => createSolveGraphImpactQueryProduct(index, { changedNodeIds: [root.id], presentation: { maxRows: 0 } }),
    /maxRows/,
  );
});
