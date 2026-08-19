import assert from "node:assert/strict";
import test from "node:test";
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { findSolveGraphShortestPath } from "./shortest-path";

async function fixtureGraph() {
  const repository = await createSolveGraphNode({
    kind: "repository",
    identity: "repo:shortest-path-fixture",
    label: "Shortest path fixture",
    evidence: [{ kind: "deterministic-analysis", path: "README.md" }],
  });
  const library = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/lib.ts",
    label: "src/lib.ts",
    evidence: [{ kind: "parser", path: "src/lib.ts", line: 1 }],
  });
  const service = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/service.ts",
    label: "src/service.ts",
    evidence: [{ kind: "parser", path: "src/service.ts", line: 1 }],
  });
  const route = await createSolveGraphNode({
    kind: "route",
    identity: "route:GET:/example",
    label: "GET /example",
    evidence: [{ kind: "configuration", path: "src/routes.ts", line: 8 }],
  });
  const serviceTest = await createSolveGraphNode({
    kind: "test",
    identity: "test:service",
    label: "service test",
    evidence: [{ kind: "deterministic-analysis", path: "tests/service.test.ts", line: 4 }],
  });

  const edges = [
    await createSolveGraphEdge({
      kind: "contains",
      from: repository.id,
      to: library.id,
      evidence: [{ kind: "deterministic-analysis", path: "src/lib.ts" }],
    }),
    await createSolveGraphEdge({
      kind: "imports",
      from: service.id,
      to: library.id,
      evidence: [{ kind: "parser", path: "src/service.ts", line: 1 }],
    }),
    await createSolveGraphEdge({
      kind: "calls",
      from: route.id,
      to: service.id,
      evidence: [{ kind: "parser", path: "src/routes.ts", line: 8 }],
    }),
    await createSolveGraphEdge({
      kind: "tests",
      from: serviceTest.id,
      to: service.id,
      evidence: [{ kind: "deterministic-analysis", path: "tests/service.test.ts", line: 4 }],
    }),
  ];

  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "shortest-path-fixture", version: "1", deterministic: true }],
    nodes: [serviceTest, route, service, repository, library],
    edges: [edges[3], edges[1], edges[0], edges[2]],
  });

  return { document, repository, library, service, route, serviceTest };
}

test("shortest dependency path is deterministic and records relationship hops", async () => {
  const { document, library, service, route } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);
  const result = findSolveGraphShortestPath(index, route.id, library.id, {
    edgeKinds: ["calls", "imports"],
    maxDepth: 4,
  });

  assert.equal(result.found, true);
  assert.deepEqual(result.nodeIds, [route.id, service.id, library.id]);
  assert.deepEqual(result.hops.map((hop) => hop.edgeKind), ["calls", "imports"]);
  assert.deepEqual(result.hops.map((hop) => [hop.from, hop.to]), [
    [route.id, service.id],
    [service.id, library.id],
  ]);
  assert.equal(result.truncated, false);
});

test("dependent direction can explain an inbound impact path", async () => {
  const { document, library, service, route } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);
  const result = findSolveGraphShortestPath(index, library.id, route.id, {
    direction: "dependents",
    edgeKinds: ["imports", "calls"],
  });

  assert.equal(result.found, true);
  assert.deepEqual(result.nodeIds, [library.id, service.id, route.id]);
  assert.deepEqual(result.hops.map((hop) => hop.edgeKind), ["imports", "calls"]);
});

test("unreachable paths distinguish complete absence from bounded uncertainty", async () => {
  const { document, library, route, serviceTest } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);

  const complete = findSolveGraphShortestPath(index, route.id, serviceTest.id, {
    edgeKinds: ["calls", "imports"],
  });
  assert.equal(complete.found, false);
  assert.equal(complete.truncated, false);

  const depthBound = findSolveGraphShortestPath(index, route.id, library.id, {
    edgeKinds: ["calls", "imports"],
    maxDepth: 1,
  });
  assert.equal(depthBound.found, false);
  assert.equal(depthBound.truncated, true);
  assert.equal(depthBound.truncationReason, "depth");

  const visitedBound = findSolveGraphShortestPath(index, route.id, library.id, {
    edgeKinds: ["calls", "imports"],
    maxVisited: 2,
  });
  assert.equal(visitedBound.found, false);
  assert.equal(visitedBound.truncated, true);
  assert.equal(visitedBound.truncationReason, "visited-count");
});

test("zero-hop paths and edge filters remain explicit", async () => {
  const { document, library, route } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);

  const same = findSolveGraphShortestPath(index, library.id, library.id);
  assert.equal(same.found, true);
  assert.deepEqual(same.nodeIds, [library.id]);
  assert.deepEqual(same.hops, []);

  const filtered = findSolveGraphShortestPath(index, route.id, library.id, { edgeKinds: ["imports"] });
  assert.equal(filtered.found, false);
  assert.equal(filtered.truncated, false);
});

test("invalid shortest-path input fails closed", async () => {
  const { document, library, route } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);

  assert.throws(
    () => findSolveGraphShortestPath(index, "missing", library.id),
    /source does not exist/,
  );
  assert.throws(
    () => findSolveGraphShortestPath(index, route.id, "missing"),
    /target does not exist/,
  );
  assert.throws(
    () => findSolveGraphShortestPath(index, route.id, library.id, { direction: "sideways" as never }),
    /direction is invalid/,
  );
  assert.throws(
    () => findSolveGraphShortestPath(index, route.id, library.id, { edgeKinds: ["bad" as never] }),
    /edge kind is invalid/,
  );
  assert.throws(
    () => findSolveGraphShortestPath(index, route.id, library.id, { maxDepth: 65 }),
    /maxDepth/,
  );
  assert.throws(
    () => findSolveGraphShortestPath(index, route.id, library.id, { maxVisited: 0 }),
    /maxVisited/,
  );
});
