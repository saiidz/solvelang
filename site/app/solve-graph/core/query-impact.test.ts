import assert from "node:assert/strict";
import test from "node:test";
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import {
  analyzeSolveGraphImpact,
  createSolveGraphQueryIndex,
  findSolveGraphNodes,
  traverseSolveGraph,
} from "./query-impact";

async function fixtureGraph() {
  const repository = await createSolveGraphNode({
    kind: "repository",
    identity: "repo:fixture-repository",
    label: "Fixture repository",
    evidence: [{ kind: "deterministic-analysis", path: "README.md" }],
  });
  const library = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/lib.ts",
    label: "src/lib.ts",
    evidence: [{ kind: "parser", path: "src/lib.ts", line: 1 }],
    metadata: { language: "typescript" },
  });
  const service = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/service.ts",
    label: "src/service.ts",
    evidence: [{ kind: "parser", path: "src/service.ts", line: 1 }],
    metadata: { language: "typescript" },
  });
  const route = await createSolveGraphNode({
    kind: "route",
    identity: "route:GET:/api/example",
    label: "GET /api/example",
    evidence: [{ kind: "configuration", path: "src/routes.ts", line: 8 }],
  });
  const serviceTest = await createSolveGraphNode({
    kind: "test",
    identity: "test:service",
    label: "service regression test",
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
    extractors: [{ id: "query-impact-fixture", version: "1", deterministic: true }],
    nodes: [serviceTest, route, service, repository, library],
    edges: [edges[3], edges[1], edges[0], edges[2]],
  });

  return { document, repository, library, service, route, serviceTest };
}

function ids(result: { entries: Array<{ id: string }> }): string[] {
  return result.entries.map((entry) => entry.id);
}

test("query index requires an integrity-valid canonical graph", async () => {
  const { document } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);
  assert.equal(index.nodesById.size, 5);

  const tampered = { ...document, source: { ...document.source, revision: "tampered" } };
  await assert.rejects(
    createSolveGraphQueryIndex(tampered),
    /integrity-valid canonical document/,
  );
});

test("node queries combine kind, text, and exact evidence-path filters deterministically", async () => {
  const { document, service, serviceTest } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);

  assert.deepEqual(findSolveGraphNodes(index, { kinds: ["file"] }).map((node) => node.kind), ["file", "file"]);
  assert.deepEqual(findSolveGraphNodes(index, { text: "SERVICE" }).map((node) => node.id), [service.id, serviceTest.id].sort());
  assert.deepEqual(findSolveGraphNodes(index, { evidencePath: "src/service.ts" }).map((node) => node.id), [service.id]);
  assert.deepEqual(findSolveGraphNodes(index, { text: "service", limit: 1 }).map((node) => node.id), [
    [service.id, serviceTest.id].sort()[0],
  ]);
});

test("dependency traversal follows outgoing semantic edges with deterministic shortest paths", async () => {
  const { document, library, service, route } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);
  const result = traverseSolveGraph(index, [route.id], "dependencies", {
    edgeKinds: ["calls", "imports"],
    maxDepth: 4,
  });

  assert.deepEqual(ids(result), [route.id, service.id, library.id]);
  assert.deepEqual(result.entries.map((entry) => entry.depth), [0, 1, 2]);
  assert.equal(result.entries[1].parentId, route.id);
  assert.equal(result.entries[2].parentId, service.id);
  assert.equal(result.truncated, false);
});

test("impact analysis walks incoming dependents and excludes containment noise by default", async () => {
  const { document, repository, library, service, route, serviceTest } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);
  const result = analyzeSolveGraphImpact(index, [library.id]);

  assert.deepEqual(ids(result), [library.id, service.id, ...[route.id, serviceTest.id].sort()]);
  assert.equal(ids(result).includes(repository.id), false);
  assert.deepEqual(result.entries.map((entry) => entry.depth), [0, 1, 2, 2]);
  assert.equal(result.truncated, false);
});

test("depth and result bounds report deterministic truncation instead of silently dropping blast radius", async () => {
  const { document, library, service } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);

  const depthBound = analyzeSolveGraphImpact(index, [library.id], { maxDepth: 1 });
  assert.deepEqual(ids(depthBound), [library.id, service.id]);
  assert.equal(depthBound.truncated, true);
  assert.equal(depthBound.truncationReason, "depth");

  const resultBound = analyzeSolveGraphImpact(index, [library.id], { maxResults: 2 });
  assert.deepEqual(ids(resultBound), [library.id, service.id]);
  assert.equal(resultBound.truncated, true);
  assert.equal(resultBound.truncationReason, "result-count");
});

test("invalid query and traversal input fails closed", async () => {
  const { document, library } = await fixtureGraph();
  const index = await createSolveGraphQueryIndex(document);

  assert.throws(() => findSolveGraphNodes(index, { kinds: ["not-a-kind" as never] }), /node kind is invalid/);
  assert.throws(() => findSolveGraphNodes(index, { text: "   " }), /query text must not be empty/);
  assert.throws(() => findSolveGraphNodes(index, { limit: 0 }), /query limit/);
  assert.throws(() => traverseSolveGraph(index, [], "dependencies"), /at least one root/);
  assert.throws(() => traverseSolveGraph(index, ["sgn_00000000000000000000000000000000"], "dependencies"), /root does not exist/);
  assert.throws(() => traverseSolveGraph(index, [library.id], "dependencies", { edgeKinds: ["bad" as never] }), /edge kind is invalid/);
  assert.throws(() => traverseSolveGraph(index, [library.id], "dependencies", { maxDepth: 65 }), /maxDepth/);
  assert.throws(() => traverseSolveGraph(index, [library.id], "dependencies", { maxResults: 10_001 }), /maxResults/);
});
