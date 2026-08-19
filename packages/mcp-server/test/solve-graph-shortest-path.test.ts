import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { findSolveGraphShortestPath } from "../src/solve-graph-shortest-path.js";
import {
  SOLVE_GRAPH_SCHEMA,
  canonicalSolveGraphJson,
  parseSolveGraphText,
  type SolveGraphDocument,
  type SolveGraphEdge,
  type SolveGraphEdgeKind,
  type SolveGraphNode,
  type SolveGraphNodeKind,
} from "../src/solve-graph.js";

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalSolveGraphJson(value), "utf8").digest("hex");
}

function node(kind: SolveGraphNodeKind, identity: string, label: string, path: string): SolveGraphNode {
  return {
    id: `sgn_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind, identity }).slice(0, 32)}`,
    kind,
    identity,
    label,
    evidence: [{ kind: "deterministic-analysis", path }],
    metadata: { path },
  };
}

function edge(kind: SolveGraphEdgeKind, from: string, to: string, path: string): SolveGraphEdge {
  return {
    id: `sge_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind, from, to, qualifier: "" }).slice(0, 32)}`,
    kind,
    from,
    to,
    evidence: [{ kind: "deterministic-analysis", path }],
  };
}

function graphFixture(): SolveGraphDocument {
  const library = node("file", "file:src/lib.ts", "src/lib.ts", "src/lib.ts");
  const service = node("file", "file:src/service.ts", "src/service.ts", "src/service.ts");
  const route = node("route", "route:GET:/example", "GET /example", "src/routes.ts");
  const serviceTest = node("test", "test:service", "service test", "test/service.test.ts");
  const nodes = [library, service, route, serviceTest].sort((left, right) => left.id.localeCompare(right.id));
  const edges = [
    edge("imports", service.id, library.id, "src/service.ts"),
    edge("calls", route.id, service.id, "src/routes.ts"),
    edge("tests", serviceTest.id, service.id, "test/service.test.ts"),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const source = {
    kind: "repository" as const,
    displayName: "shortest-path-fixture",
    fingerprint: `sha256:${"b".repeat(64)}`,
    revision: "test",
    private: true,
  };
  const extractors = [{ id: "shortest-path-fixture", version: "1", deterministic: true as const }];
  const limits = {
    maxFiles: 100,
    maxTotalBytes: 1_000_000,
    maxFileBytes: 100_000,
    maxDepth: 16,
    maxNodes: 1_000,
    maxEdges: 2_000,
    maxEvidencePerElement: 10,
    maxMetadataEntries: 10,
    maxMetadataStringBytes: 2_048,
    maxIdentityBytes: 2_048,
  };
  const graphId = `sg_${digest({
    schema: SOLVE_GRAPH_SCHEMA,
    sourceFingerprint: source.fingerprint,
    engineVersion: "0.2.0",
    extractors,
    limits,
  }).slice(0, 32)}`;
  const withoutIntegrity = {
    schema: SOLVE_GRAPH_SCHEMA,
    graphId,
    mode: "analyze-only" as const,
    engine: { name: "SolveLang Solve Graph", version: "0.2.0", deterministic: true as const },
    source,
    extractors,
    limits,
    execution: {
      status: "complete" as const,
      truncated: false,
      truncationReasons: [],
      networkAccess: false as const,
      writeAccess: false as const,
    },
    nodes,
    edges,
  };
  const integrityBase = { stableIds: true as const, ordering: "id-ascending" as const };
  return {
    ...withoutIntegrity,
    integrity: {
      canonicalJsonSha256: `sha256:${digest({ ...withoutIntegrity, integrity: integrityBase })}`,
      ...integrityBase,
    },
  };
}

function parsedFixture() {
  const graph = parseSolveGraphText(JSON.stringify(graphFixture()));
  const byIdentity = new Map(graph.nodes.map((item) => [item.identity, item]));
  return {
    graph,
    library: byIdentity.get("file:src/lib.ts")!,
    service: byIdentity.get("file:src/service.ts")!,
    route: byIdentity.get("route:GET:/example")!,
    serviceTest: byIdentity.get("test:service")!,
  };
}

test("shortest path returns deterministic safe dependency explanations", () => {
  const { graph, library, service, route } = parsedFixture();
  const result = findSolveGraphShortestPath(graph, route.id, library.id, {
    edgeKinds: ["calls", "imports"],
    maxDepth: 4,
  });

  assert.equal(result.found, true);
  assert.deepEqual(result.nodes.map((item) => item.id), [route.id, service.id, library.id]);
  assert.deepEqual(result.hops.map((item) => item.edgeKind), ["calls", "imports"]);
  assert.deepEqual(result.hops.map((item) => [item.traversalFromId, item.traversalToId]), [
    [route.id, service.id],
    [service.id, library.id],
  ]);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.execution, { networkAccess: false, writeAccess: false, maxDepth: 4, maxVisited: 1_000 });
  assert.ok(result.nodes.every((item) => !Object.hasOwn(item, "identity") && !Object.hasOwn(item, "evidence")));
});

test("dependent paths preserve underlying edge orientation separately from traversal orientation", () => {
  const { graph, library, service, route } = parsedFixture();
  const result = findSolveGraphShortestPath(graph, library.id, route.id, {
    direction: "dependents",
    edgeKinds: ["imports", "calls"],
  });

  assert.equal(result.found, true);
  assert.deepEqual(result.nodes.map((item) => item.id), [library.id, service.id, route.id]);
  assert.deepEqual(result.hops.map((item) => [item.edgeFromId, item.edgeToId]), [
    [service.id, library.id],
    [route.id, service.id],
  ]);
  assert.deepEqual(result.hops.map((item) => [item.traversalFromId, item.traversalToId]), [
    [library.id, service.id],
    [service.id, route.id],
  ]);
});

test("no-path results distinguish complete absence from bounded uncertainty", () => {
  const { graph, library, route, serviceTest } = parsedFixture();

  const complete = findSolveGraphShortestPath(graph, route.id, serviceTest.id, { edgeKinds: ["calls", "imports"] });
  assert.equal(complete.found, false);
  assert.equal(complete.truncated, false);
  assert.deepEqual(complete.nodes, []);

  const depthBound = findSolveGraphShortestPath(graph, route.id, library.id, {
    edgeKinds: ["calls", "imports"],
    maxDepth: 1,
  });
  assert.equal(depthBound.found, false);
  assert.equal(depthBound.truncated, true);
  assert.equal(depthBound.truncationReason, "depth");

  const visitedBound = findSolveGraphShortestPath(graph, route.id, library.id, {
    edgeKinds: ["calls", "imports"],
    maxVisited: 2,
  });
  assert.equal(visitedBound.found, false);
  assert.equal(visitedBound.truncated, true);
  assert.equal(visitedBound.truncationReason, "visited-count");
});

test("zero-hop paths and invalid input fail closed", () => {
  const { graph, library, route } = parsedFixture();
  const same = findSolveGraphShortestPath(graph, library.id, library.id);
  assert.equal(same.found, true);
  assert.deepEqual(same.nodes.map((item) => item.id), [library.id]);
  assert.deepEqual(same.hops, []);

  assert.throws(() => findSolveGraphShortestPath(graph, "missing", library.id), /source does not exist/);
  assert.throws(() => findSolveGraphShortestPath(graph, route.id, "missing"), /target does not exist/);
  assert.throws(() => findSolveGraphShortestPath(graph, route.id, library.id, { direction: "sideways" as never }), /direction is invalid/);
  assert.throws(() => findSolveGraphShortestPath(graph, route.id, library.id, { edgeKinds: ["bad" as never] }), /edge kind is invalid/);
  assert.throws(() => findSolveGraphShortestPath(graph, route.id, library.id, { maxDepth: 65 }), /maxDepth/);
  assert.throws(() => findSolveGraphShortestPath(graph, route.id, library.id, { maxVisited: 0 }), /maxVisited/);
});
