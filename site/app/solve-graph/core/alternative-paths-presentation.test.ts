import assert from "node:assert/strict";
import test from "node:test";
import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { findSolveGraphAlternativePaths } from "./alternative-paths";
import { createSolveGraphAlternativePathsPresentation } from "./alternative-paths-presentation";

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
    extractors: [{ id: "alternative-presentation-fixture", version: "1", deterministic: true }],
    nodes: [target, right, source, left],
    edges: [edges[4], edges[2], edges[0], edges[3], edges[1]],
  });
  const index = await createSolveGraphQueryIndex(document);
  return { index, source, target };
}

test("creates deterministic browser-ready alternative-path rows with safe node summaries", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const first = createSolveGraphAlternativePathsPresentation(index, result);
  const second = createSolveGraphAlternativePathsPresentation(index, result);

  assert.deepEqual(first, second);
  assert.equal(first.rows.length, 3);
  assert.deepEqual(first.rows.map((row) => row.hopCount), [1, 2, 2]);
  assert.equal(first.rows[0]!.nodes[0]!.label, "a.ts");
  assert.equal(first.rows[0]!.nodes[0]!.path, "src/a.ts");
  assert.equal(first.rows[0]!.nodes.at(-1)!.label, "d.ts");
  assert.equal(first.status, "complete");
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
});

test("presentation bounds are independent and preserve query truncation truth", async () => {
  const { index, source, target } = await fixture();
  const complete = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const bounded = createSolveGraphAlternativePathsPresentation(index, complete, { maxPaths: 1 });
  assert.equal(bounded.rows.length, 1);
  assert.equal(bounded.summary.hiddenPaths, 2);
  assert.equal(bounded.execution.presentationTruncated, true);
  assert.equal(bounded.status, "partial");
  assert.ok(bounded.notices.some((notice) => notice.includes("first bounded subset")));

  const queryBounded = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["imports", "calls"], maxPaths: 1 });
  const queryPresentation = createSolveGraphAlternativePathsPresentation(index, queryBounded);
  assert.equal(queryPresentation.execution.queryTruncated, true);
  assert.equal(queryPresentation.status, "partial");
  assert.ok(queryPresentation.notices.some((notice) => notice.includes("path-count bound")));
});

test("zero-path presentations remain complete when the query proves no path within untruncated bounds", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["tests"] });
  const presentation = createSolveGraphAlternativePathsPresentation(index, result);

  assert.equal(presentation.rows.length, 0);
  assert.equal(presentation.summary.availablePaths, 0);
  assert.equal(presentation.summary.minimumHops, undefined);
  assert.equal(presentation.status, "complete");
  assert.deepEqual(presentation.notices, []);
});

test("malformed result contracts and invalid presentation bounds fail closed", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const malformed = structuredClone(result);
  malformed.paths[0]!.hops[0]!.edgeId = "sge_missing";
  assert.throws(() => createSolveGraphAlternativePathsPresentation(index, malformed), /missing or mismatched edge/);
  assert.throws(() => createSolveGraphAlternativePathsPresentation(index, result, { maxPaths: 0 }), /maxPaths/);
  assert.throws(() => createSolveGraphAlternativePathsPresentation(index, result, { maxPaths: 65 }), /maxPaths/);
});
