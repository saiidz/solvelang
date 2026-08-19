import assert from "node:assert/strict";
import test from "node:test";

import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { findSolveGraphShortestPath } from "./shortest-path";
import { createSolveGraphShortestPathPresentation } from "./shortest-path-presentation";

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
    extractors: [{ id: "shortest-path-presentation-fixture", version: "1", deterministic: true }],
    nodes: [target, source, middle],
    edges: [second, direct, first],
  });
  return { index: await createSolveGraphQueryIndex(document), source, target };
}

test("creates deterministic browser-safe shortest-path presentation", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphShortestPath(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const first = createSolveGraphShortestPathPresentation(index, result);
  const second = createSolveGraphShortestPathPresentation(index, structuredClone(result));

  assert.deepEqual(first, second);
  assert.equal(first.found, true);
  assert.equal(first.status, "complete");
  assert.equal(first.summary.hopCount, 1);
  assert.equal(first.nodes[0]!.label, "a.ts");
  assert.equal(first.nodes[0]!.path, "src/a.ts");
  assert.equal(first.nodes.at(-1)!.label, "c.ts");
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.deepEqual(first.notices, []);
});

test("presents zero-hop and complete no-path results without claiming partial coverage", async () => {
  const { index, source, target } = await fixture();
  const zero = createSolveGraphShortestPathPresentation(
    index,
    findSolveGraphShortestPath(index, source.id, source.id),
  );
  assert.equal(zero.found, true);
  assert.equal(zero.summary.hopCount, 0);
  assert.equal(zero.nodes.length, 1);
  assert.equal(zero.status, "complete");

  const none = createSolveGraphShortestPathPresentation(
    index,
    findSolveGraphShortestPath(index, source.id, target.id, { edgeKinds: ["tests"] }),
  );
  assert.equal(none.found, false);
  assert.equal(none.status, "complete");
  assert.equal(none.nodes.length, 0);
  assert.match(none.notices.join(" "), /No path was found/);
});

test("keeps depth and visited-count truncation explicit", async () => {
  const { index, source, target } = await fixture();
  const depth = createSolveGraphShortestPathPresentation(
    index,
    findSolveGraphShortestPath(index, source.id, target.id, { maxDepth: 0 }),
  );
  assert.equal(depth.found, false);
  assert.equal(depth.status, "partial");
  assert.equal(depth.execution.queryTruncated, true);
  assert.match(depth.notices.join(" "), /depth bound/);

  const visited = createSolveGraphShortestPathPresentation(
    index,
    findSolveGraphShortestPath(index, source.id, target.id, { maxVisited: 1 }),
  );
  assert.equal(visited.status, "partial");
  assert.match(visited.notices.join(" "), /visited-node bound/);
});

test("fails closed for malformed path, edge, and truncation contracts", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphShortestPath(index, source.id, target.id);

  const badEdge = structuredClone(result);
  badEdge.hops[0]!.edgeId = "sge_missing";
  assert.throws(() => createSolveGraphShortestPathPresentation(index, badEdge), /missing or mismatched edge/);

  const badReason = { ...structuredClone(result), truncated: true, truncationReason: "unknown" as never };
  assert.throws(() => createSolveGraphShortestPathPresentation(index, badReason), /truncation reason is invalid/);

  const falseWithPath = { ...structuredClone(result), found: false };
  assert.throws(() => createSolveGraphShortestPathPresentation(index, falseWithPath), /must not contain a path/);
});
