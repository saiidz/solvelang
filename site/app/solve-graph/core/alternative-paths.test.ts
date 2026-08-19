import assert from "node:assert/strict";
import test from "node:test";
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { findSolveGraphAlternativePaths } from "./alternative-paths";

async function fixtureGraph() {
  const source = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/source.ts",
    label: "source.ts",
    evidence: [{ kind: "parser", path: "src/source.ts", line: 1 }],
  });
  const left = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/left.ts",
    label: "left.ts",
    evidence: [{ kind: "parser", path: "src/left.ts", line: 1 }],
  });
  const right = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/right.ts",
    label: "right.ts",
    evidence: [{ kind: "parser", path: "src/right.ts", line: 1 }],
  });
  const target = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/target.ts",
    label: "target.ts",
    evidence: [{ kind: "parser", path: "src/target.ts", line: 1 }],
  });

  const edges = [
    await createSolveGraphEdge({
      kind: "imports",
      from: source.id,
      to: target.id,
      evidence: [{ kind: "parser", path: "src/source.ts", line: 1 }],
    }),
    await createSolveGraphEdge({
      kind: "imports",
      from: source.id,
      to: left.id,
      evidence: [{ kind: "parser", path: "src/source.ts", line: 2 }],
    }),
    await createSolveGraphEdge({
      kind: "calls",
      from: left.id,
      to: target.id,
      evidence: [{ kind: "parser", path: "src/left.ts", line: 3 }],
    }),
    await createSolveGraphEdge({
      kind: "imports",
      from: source.id,
      to: right.id,
      evidence: [{ kind: "parser", path: "src/source.ts", line: 4 }],
    }),
    await createSolveGraphEdge({
      kind: "calls",
      from: right.id,
      to: target.id,
      evidence: [{ kind: "parser", path: "src/right.ts", line: 5 }],
    }),
    await createSolveGraphEdge({
      kind: "references",
      from: right.id,
      to: source.id,
      evidence: [{ kind: "parser", path: "src/right.ts", line: 6 }],
    }),
  ];

  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "alternative-path-fixture", version: "1", deterministic: true }],
    nodes: [target, right, source, left],
    edges: [edges[5], edges[3], edges[1], edges[4], edges[0], edges[2]],
  });

  return { document, source, left, right, target };
}

test("enumerates deterministic simple alternative dependency paths from shortest to longer", async () => {
  const { document, source, left, right, target } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);
  const result = findSolveGraphAlternativePaths(index, source.id, target.id, {
    edgeKinds: ["imports", "calls", "references"],
    maxDepth: 4,
    maxPaths: 8,
  });

  assert.equal(result.paths.length, 3);
  assert.deepEqual(result.paths.map((path) => path.hops.length), [1, 2, 2]);
  assert.deepEqual(result.paths[0].nodeIds, [source.id, target.id]);
  const longer = result.paths.slice(1).map((path) => path.nodeIds);
  assert.ok(longer.some((path) => path.join("|") === [source.id, left.id, target.id].join("|")));
  assert.ok(longer.some((path) => path.join("|") === [source.id, right.id, target.id].join("|")));
  assert.ok(result.paths.every((path) => new Set(path.nodeIds).size === path.nodeIds.length));
  assert.equal(result.truncated, false);
});

test("supports dependent-direction alternatives with traversal-oriented hops", async () => {
  const { document, source, target } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);
  const result = findSolveGraphAlternativePaths(index, target.id, source.id, {
    direction: "dependents",
    edgeKinds: ["imports", "calls"],
  });

  assert.equal(result.paths.length, 3);
  assert.deepEqual(result.paths[0].nodeIds, [target.id, source.id]);
  assert.ok(result.paths.every((path) => path.hops.every((hop, index) =>
    hop.from === path.nodeIds[index] && hop.to === path.nodeIds[index + 1])));
});

test("reports path, depth, and state bounds instead of implying complete enumeration", async () => {
  const { document, source, target } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);

  const pathBound = findSolveGraphAlternativePaths(index, source.id, target.id, {
    edgeKinds: ["imports", "calls"],
    maxPaths: 1,
  });
  assert.equal(pathBound.paths.length, 1);
  assert.equal(pathBound.truncated, true);
  assert.equal(pathBound.truncationReason, "path-count");

  const depthBound = findSolveGraphAlternativePaths(index, source.id, target.id, {
    edgeKinds: ["imports", "calls"],
    maxDepth: 1,
    maxPaths: 8,
  });
  assert.equal(depthBound.paths.length, 1);
  assert.equal(depthBound.truncated, true);
  assert.equal(depthBound.truncationReason, "depth");

  const stateBound = findSolveGraphAlternativePaths(index, source.id, target.id, {
    edgeKinds: ["imports", "calls"],
    maxStates: 1,
  });
  assert.equal(stateBound.paths.length, 0);
  assert.equal(stateBound.truncated, true);
  assert.equal(stateBound.truncationReason, "state-count");
});

test("zero-hop and filtered no-path results remain explicit", async () => {
  const { document, source, target } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);

  const same = findSolveGraphAlternativePaths(index, source.id, source.id);
  assert.deepEqual(same.paths, [{ nodeIds: [source.id], hops: [] }]);
  assert.equal(same.truncated, false);

  const filtered = findSolveGraphAlternativePaths(index, source.id, target.id, {
    edgeKinds: ["tests"],
  });
  assert.deepEqual(filtered.paths, []);
  assert.equal(filtered.truncated, false);
});

test("invalid alternative-path input fails closed", async () => {
  const { document, source, target } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);

  assert.throws(() => findSolveGraphAlternativePaths(index, "missing", target.id), /source does not exist/);
  assert.throws(() => findSolveGraphAlternativePaths(index, source.id, "missing"), /target does not exist/);
  assert.throws(
    () => findSolveGraphAlternativePaths(index, source.id, target.id, { direction: "sideways" as never }),
    /direction is invalid/,
  );
  assert.throws(
    () => findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["bad" as never] }),
    /edge kind is invalid/,
  );
  assert.throws(() => findSolveGraphAlternativePaths(index, source.id, target.id, { maxDepth: 33 }), /maxDepth/);
  assert.throws(() => findSolveGraphAlternativePaths(index, source.id, target.id, { maxPaths: 0 }), /maxPaths/);
  assert.throws(() => findSolveGraphAlternativePaths(index, source.id, target.id, { maxStates: 0 }), /maxStates/);
});
