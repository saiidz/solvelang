import assert from "node:assert/strict";
import test from "node:test";
import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { findSolveGraphAlternativePaths } from "./alternative-paths";
import { createSolveGraphAlternativePathsProductBundle } from "./alternative-paths-product";

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
    extractors: [{ id: "alternative-product-fixture", version: "1", deterministic: true }],
    nodes: [target, right, source, left],
    edges: [edges[4], edges[2], edges[0], edges[3], edges[1]],
  });
  const index = await createSolveGraphQueryIndex(document);
  return { index, source, target };
}

test("composes deterministic alternative-path artifact and presentation without capabilities", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const first = await createSolveGraphAlternativePathsProductBundle("repo.zip", index, result);
  const second = await createSolveGraphAlternativePathsProductBundle("repo.zip", index, structuredClone(result));

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.solve-graph.alternative-paths-product.v0");
  assert.equal(first.status, "complete");
  assert.equal(first.graphId, index.document.graphId);
  assert.equal(first.download.artifact.paths.length, 3);
  assert.equal(first.presentation.summary.availablePaths, 3);
  assert.equal(first.execution.queryTruncated, false);
  assert.equal(first.execution.presentationRowsTruncated, false);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.match(first.download.artifact.integrity.canonicalJsonSha256, /^[a-f0-9]{64}$/);
});

test("keeps query truncation distinct from presentation row truncation", async () => {
  const { index, source, target } = await fixture();
  const complete = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const presentationBounded = await createSolveGraphAlternativePathsProductBundle(
    "repo.zip",
    index,
    complete,
    { maxPaths: 1 },
  );
  assert.equal(presentationBounded.status, "partial");
  assert.equal(presentationBounded.execution.queryTruncated, false);
  assert.equal(presentationBounded.execution.presentationRowsTruncated, true);
  assert.equal(presentationBounded.download.artifact.paths.length, 3);
  assert.equal(presentationBounded.presentation.rows.length, 1);

  const queryBounded = findSolveGraphAlternativePaths(index, source.id, target.id, {
    edgeKinds: ["imports", "calls"],
    maxPaths: 1,
  });
  const queryBundle = await createSolveGraphAlternativePathsProductBundle("repo.zip", index, queryBounded);
  assert.equal(queryBundle.status, "partial");
  assert.equal(queryBundle.execution.queryTruncated, true);
  assert.equal(queryBundle.execution.presentationRowsTruncated, false);
  assert.equal(queryBundle.download.artifact.truncationReason, "path-count");
});

test("bundle outputs remain detached from later result mutation", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const bundle = await createSolveGraphAlternativePathsProductBundle("repo.zip", index, result);
  const originalNodeId = bundle.download.artifact.paths[0]!.nodeIds[0]!;
  const originalHopId = bundle.presentation.rows[0]!.hops[0]!.edgeId;

  result.paths[0]!.nodeIds[0] = "sgn_mutated";
  result.paths[0]!.hops[0]!.edgeId = "sge_mutated";

  assert.equal(bundle.download.artifact.paths[0]!.nodeIds[0], originalNodeId);
  assert.equal(bundle.presentation.rows[0]!.hops[0]!.edgeId, originalHopId);
});

test("malformed query results fail closed before product composition", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const malformed = structuredClone(result);
  malformed.paths[0]!.hops[0]!.edgeId = "sge_missing";

  await assert.rejects(
    createSolveGraphAlternativePathsProductBundle("repo.zip", index, malformed),
    /missing or mismatched edge/,
  );
});
