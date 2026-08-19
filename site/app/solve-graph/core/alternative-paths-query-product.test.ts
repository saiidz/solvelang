import assert from "node:assert/strict";
import test from "node:test";

import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { createSolveGraphAlternativePathsQueryProduct } from "./alternative-paths-query-product";

async function fixture() {
  const source = await createSolveGraphNode({ kind: "file", identity: "file:src/a.ts", label: "a.ts", evidence: [{ kind: "parser", path: "src/a.ts" }], metadata: { path: "src/a.ts" } });
  const left = await createSolveGraphNode({ kind: "file", identity: "file:src/b.ts", label: "b.ts", evidence: [{ kind: "parser", path: "src/b.ts" }], metadata: { path: "src/b.ts" } });
  const right = await createSolveGraphNode({ kind: "file", identity: "file:src/c.ts", label: "c.ts", evidence: [{ kind: "parser", path: "src/c.ts" }], metadata: { path: "src/c.ts" } });
  const target = await createSolveGraphNode({ kind: "file", identity: "file:src/d.ts", label: "d.ts", evidence: [{ kind: "parser", path: "src/d.ts" }], metadata: { path: "src/d.ts" } });
  const edges = [
    await createSolveGraphEdge({ kind: "imports", from: source.id, to: target.id, evidence: [{ kind: "parser", path: "src/a.ts" }] }),
    await createSolveGraphEdge({ kind: "imports", from: source.id, to: left.id, evidence: [{ kind: "parser", path: "src/a.ts" }] }),
    await createSolveGraphEdge({ kind: "calls", from: left.id, to: target.id, evidence: [{ kind: "parser", path: "src/b.ts" }] }),
    await createSolveGraphEdge({ kind: "imports", from: source.id, to: right.id, evidence: [{ kind: "parser", path: "src/a.ts" }] }),
    await createSolveGraphEdge({ kind: "calls", from: right.id, to: target.id, evidence: [{ kind: "parser", path: "src/c.ts" }] }),
  ];
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "alternative-query-product-fixture", version: "1", deterministic: true }],
    nodes: [target, right, source, left],
    edges: [edges[4], edges[2], edges[0], edges[3], edges[1]],
  });
  return { index: await createSolveGraphQueryIndex(document), source, target };
}

test("runs one deterministic bounded query into one integrity-covered product", async () => {
  const { index, source, target } = await fixture();
  const request = {
    sourceName: "repo.zip",
    sourceId: source.id,
    targetId: target.id,
    query: { edgeKinds: ["imports", "calls"] as const, maxDepth: 4, maxPaths: 8, maxStates: 100 },
    presentation: { maxPaths: 2 },
  };

  const first = await createSolveGraphAlternativePathsQueryProduct(index, request);
  const second = await createSolveGraphAlternativePathsQueryProduct(index, structuredClone(request));

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.solve-graph.alternative-paths-query-product.v0");
  assert.equal(first.graphId, index.document.graphId);
  assert.equal(first.query.paths.length, 3);
  assert.equal(first.product.download.artifact.paths.length, 3);
  assert.equal(first.product.presentation.rows.length, 2);
  assert.equal(first.product.execution.queryTruncated, false);
  assert.equal(first.product.execution.presentationRowsTruncated, true);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
});

test("keeps query options detached from caller mutation", async () => {
  const { index, source, target } = await fixture();
  const edgeKinds: Array<"imports" | "calls"> = ["imports", "calls"];
  const request = {
    sourceName: "repo.zip",
    sourceId: source.id,
    targetId: target.id,
    query: { edgeKinds, maxPaths: 2 },
  };
  const product = await createSolveGraphAlternativePathsQueryProduct(index, request);

  edgeKinds.length = 0;
  request.query.maxPaths = 1;

  assert.deepEqual(product.request.edgeKinds, ["imports", "calls"]);
  assert.equal(product.request.maxPaths, 2);
  assert.equal(product.query.paths.length, 2);
});

test("propagates query truncation truth without confusing it with presentation bounds", async () => {
  const { index, source, target } = await fixture();
  const product = await createSolveGraphAlternativePathsQueryProduct(index, {
    sourceName: "repo.zip",
    sourceId: source.id,
    targetId: target.id,
    query: { edgeKinds: ["imports", "calls"], maxPaths: 1 },
    presentation: { maxPaths: 8 },
  });

  assert.equal(product.query.truncated, true);
  assert.equal(product.query.truncationReason, "path-count");
  assert.equal(product.product.execution.queryTruncated, true);
  assert.equal(product.product.execution.presentationRowsTruncated, false);
  assert.equal(product.product.status, "partial");
});

test("fails closed on unsafe labels, missing endpoints, and invalid query or presentation bounds", async () => {
  const { index, source, target } = await fixture();

  await assert.rejects(
    createSolveGraphAlternativePathsQueryProduct(index, {
      sourceName: "bad\nname",
      sourceId: source.id,
      targetId: target.id,
    }),
    /sourceName is invalid/,
  );
  await assert.rejects(
    createSolveGraphAlternativePathsQueryProduct(index, {
      sourceName: "repo.zip",
      sourceId: "sgn_missing",
      targetId: target.id,
    }),
    /source does not exist/,
  );
  await assert.rejects(
    createSolveGraphAlternativePathsQueryProduct(index, {
      sourceName: "repo.zip",
      sourceId: source.id,
      targetId: target.id,
      query: { maxPaths: 0 },
    }),
    /maxPaths/,
  );
  await assert.rejects(
    createSolveGraphAlternativePathsQueryProduct(index, {
      sourceName: "repo.zip",
      sourceId: source.id,
      targetId: target.id,
      presentation: { maxPaths: 65 },
    }),
    /maxPaths/,
  );
});
