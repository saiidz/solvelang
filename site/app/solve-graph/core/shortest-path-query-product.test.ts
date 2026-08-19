import assert from "node:assert/strict";
import test from "node:test";

import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { createSolveGraphShortestPathQueryProduct } from "./shortest-path-query-product";

async function fixture() {
  const source = await createSolveGraphNode({ kind: "file", identity: "file:src/a.ts", label: "a.ts", evidence: [{ kind: "parser", path: "src/a.ts" }] });
  const middle = await createSolveGraphNode({ kind: "file", identity: "file:src/b.ts", label: "b.ts", evidence: [{ kind: "parser", path: "src/b.ts" }] });
  const target = await createSolveGraphNode({ kind: "file", identity: "file:src/c.ts", label: "c.ts", evidence: [{ kind: "parser", path: "src/c.ts" }] });
  const direct = await createSolveGraphEdge({ kind: "imports", from: source.id, to: target.id, evidence: [{ kind: "parser", path: "src/a.ts" }] });
  const first = await createSolveGraphEdge({ kind: "imports", from: source.id, to: middle.id, evidence: [{ kind: "parser", path: "src/a.ts" }] });
  const second = await createSolveGraphEdge({ kind: "calls", from: middle.id, to: target.id, evidence: [{ kind: "parser", path: "src/b.ts" }] });
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "shortest-query-product-fixture", version: "1", deterministic: true }],
    nodes: [target, source, middle],
    edges: [second, direct, first],
  });
  return { index: await createSolveGraphQueryIndex(document), source, target };
}

test("runs one deterministic shortest-path query into one product bundle", async () => {
  const { index, source, target } = await fixture();
  const request = {
    sourceName: "repo.zip",
    sourceId: source.id,
    targetId: target.id,
    query: { edgeKinds: ["imports", "calls"] as const, maxDepth: 4, maxVisited: 100 },
  };
  const first = await createSolveGraphShortestPathQueryProduct(index, request);
  const second = await createSolveGraphShortestPathQueryProduct(index, structuredClone(request));

  assert.deepEqual(first, second);
  assert.equal(first.graphId, index.document.graphId);
  assert.equal(first.query.found, true);
  assert.equal(first.product.found, true);
  assert.equal(first.product.status, "complete");
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
});

test("keeps request options detached from caller mutation", async () => {
  const { index, source, target } = await fixture();
  const edgeKinds: Array<"imports" | "calls"> = ["imports", "calls"];
  const request = { sourceName: "repo.zip", sourceId: source.id, targetId: target.id, query: { edgeKinds, maxVisited: 50 } };
  const result = await createSolveGraphShortestPathQueryProduct(index, request);

  edgeKinds.length = 0;
  request.query.maxVisited = 1;

  assert.deepEqual(result.request.edgeKinds, ["imports", "calls"]);
  assert.equal(result.request.maxVisited, 50);
  assert.equal(result.query.found, true);
});

test("propagates bounded partial query truth into the product", async () => {
  const { index, source, target } = await fixture();
  const result = await createSolveGraphShortestPathQueryProduct(index, {
    sourceName: "repo.zip",
    sourceId: source.id,
    targetId: target.id,
    query: { maxDepth: 0 },
  });

  assert.equal(result.query.found, false);
  assert.equal(result.query.truncated, true);
  assert.equal(result.query.truncationReason, "depth");
  assert.equal(result.product.status, "partial");
  assert.equal(result.product.execution.queryTruncated, true);
});

test("fails closed on unsafe labels, missing endpoints, and invalid query bounds", async () => {
  const { index, source, target } = await fixture();
  await assert.rejects(
    createSolveGraphShortestPathQueryProduct(index, { sourceName: "bad\nname", sourceId: source.id, targetId: target.id }),
    /sourceName is invalid/,
  );
  await assert.rejects(
    createSolveGraphShortestPathQueryProduct(index, { sourceName: "repo.zip", sourceId: "sgn_missing", targetId: target.id }),
    /source does not exist/,
  );
  await assert.rejects(
    createSolveGraphShortestPathQueryProduct(index, { sourceName: "repo.zip", sourceId: source.id, targetId: target.id, query: { maxVisited: 0 } }),
    /maxVisited/,
  );
});
