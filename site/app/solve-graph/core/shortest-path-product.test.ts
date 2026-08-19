import assert from "node:assert/strict";
import test from "node:test";

import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { findSolveGraphShortestPath } from "./shortest-path";
import { createSolveGraphShortestPathProductBundle } from "./shortest-path-product";

async function fixture() {
  const source = await createSolveGraphNode({ kind: "file", identity: "file:src/a.ts", label: "a.ts", evidence: [{ kind: "parser", path: "src/a.ts" }], metadata: { path: "src/a.ts" } });
  const middle = await createSolveGraphNode({ kind: "file", identity: "file:src/b.ts", label: "b.ts", evidence: [{ kind: "parser", path: "src/b.ts" }], metadata: { path: "src/b.ts" } });
  const target = await createSolveGraphNode({ kind: "file", identity: "file:src/c.ts", label: "c.ts", evidence: [{ kind: "parser", path: "src/c.ts" }], metadata: { path: "src/c.ts" } });
  const direct = await createSolveGraphEdge({ kind: "imports", from: source.id, to: target.id, evidence: [{ kind: "parser", path: "src/a.ts" }] });
  const first = await createSolveGraphEdge({ kind: "imports", from: source.id, to: middle.id, evidence: [{ kind: "parser", path: "src/a.ts" }] });
  const second = await createSolveGraphEdge({ kind: "calls", from: middle.id, to: target.id, evidence: [{ kind: "parser", path: "src/b.ts" }] });
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "shortest-path-product-fixture", version: "1", deterministic: true }],
    nodes: [target, source, middle],
    edges: [second, direct, first],
  });
  return { index: await createSolveGraphQueryIndex(document), source, target };
}

test("composes deterministic shortest-path artifact and presentation from one result", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphShortestPath(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const first = await createSolveGraphShortestPathProductBundle("repo.zip", index, result);
  const second = await createSolveGraphShortestPathProductBundle("repo.zip", index, structuredClone(result));

  assert.deepEqual(first, second);
  assert.equal(first.graphId, index.document.graphId);
  assert.equal(first.found, true);
  assert.equal(first.status, "complete");
  assert.equal(first.download.artifact.nodeIds.length, 2);
  assert.equal(first.presentation.summary.hopCount, 1);
  assert.equal(first.execution.queryTruncated, false);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
});

test("preserves complete no-path and zero-hop truth", async () => {
  const { index, source, target } = await fixture();
  const none = await createSolveGraphShortestPathProductBundle(
    "repo.zip",
    index,
    findSolveGraphShortestPath(index, source.id, target.id, { edgeKinds: ["tests"] }),
  );
  assert.equal(none.found, false);
  assert.equal(none.status, "complete");
  assert.equal(none.download.artifact.truncated, false);
  assert.match(none.presentation.notices.join(" "), /No path was found/);

  const zero = await createSolveGraphShortestPathProductBundle(
    "repo.zip",
    index,
    findSolveGraphShortestPath(index, source.id, source.id),
  );
  assert.equal(zero.found, true);
  assert.equal(zero.presentation.summary.hopCount, 0);
  assert.equal(zero.download.artifact.nodeIds.length, 1);
  assert.equal(zero.status, "complete");
});

test("propagates bounded partial query truth consistently across outputs", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphShortestPath(index, source.id, target.id, { maxDepth: 0 });
  const product = await createSolveGraphShortestPathProductBundle("repo.zip", index, result);

  assert.equal(product.found, false);
  assert.equal(product.status, "partial");
  assert.equal(product.execution.queryTruncated, true);
  assert.equal(product.download.artifact.truncationReason, "depth");
  assert.equal(product.presentation.execution.queryTruncated, true);
  assert.match(product.presentation.notices.join(" "), /depth bound/);
});

test("outputs are detached from later caller mutation", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphShortestPath(index, source.id, target.id);
  const product = await createSolveGraphShortestPathProductBundle("repo.zip", index, result);
  const originalNode = product.download.artifact.nodeIds[0]!;
  const originalPresentationLabel = product.presentation.nodes[0]!.label;

  result.nodeIds[0] = "sgn_mutated";
  result.hops[0]!.from = "sgn_mutated";

  assert.equal(product.download.artifact.nodeIds[0], originalNode);
  assert.equal(product.presentation.nodes[0]!.label, originalPresentationLabel);
  assert.notEqual(product.download.artifact.hops[0]!.from, "sgn_mutated");
});

test("malformed input fails once through synchronous presentation validation", async () => {
  const { index, source, target } = await fixture();
  const malformed = findSolveGraphShortestPath(index, source.id, target.id);
  malformed.hops[0]!.edgeId = "sge_missing";

  await assert.rejects(
    createSolveGraphShortestPathProductBundle("repo.zip", index, malformed),
    /missing or mismatched edge/,
  );
});
