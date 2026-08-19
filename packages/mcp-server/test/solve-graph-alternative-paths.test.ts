import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { findSolveGraphAlternativePaths } from "../src/solve-graph-alternative-paths.js";
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
  const primary = node("file", "file:src/primary.ts", "src/primary.ts", "src/primary.ts");
  const secondary = node("file", "file:src/secondary.ts", "src/secondary.ts", "src/secondary.ts");
  const route = node("route", "route:GET:/example", "GET /example", "src/routes.ts");
  const routeTest = node("test", "test:route", "route test", "test/route.test.ts");
  const nodes = [library, primary, secondary, route, routeTest].sort((left, right) => left.id.localeCompare(right.id));
  const edges = [
    edge("calls", route.id, primary.id, "src/routes.ts"),
    edge("imports", primary.id, library.id, "src/primary.ts"),
    edge("calls", route.id, secondary.id, "src/routes.ts"),
    edge("imports", secondary.id, library.id, "src/secondary.ts"),
    edge("imports", route.id, library.id, "src/routes.ts"),
    edge("tests", routeTest.id, route.id, "test/route.test.ts"),
    edge("references", secondary.id, route.id, "src/secondary.ts"),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const source = {
    kind: "repository" as const,
    displayName: "alternative-path-fixture",
    fingerprint: `sha256:${"c".repeat(64)}`,
    revision: "test",
    private: true,
  };
  const extractors = [{ id: "alternative-path-fixture", version: "1", deterministic: true as const }];
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
    primary: byIdentity.get("file:src/primary.ts")!,
    secondary: byIdentity.get("file:src/secondary.ts")!,
    route: byIdentity.get("route:GET:/example")!,
    routeTest: byIdentity.get("test:route")!,
  };
}

test("alternative paths return deterministic safe dependency explanations from shortest to longer", () => {
  const { graph, library, primary, secondary, route } = parsedFixture();
  const result = findSolveGraphAlternativePaths(graph, route.id, library.id, {
    edgeKinds: ["calls", "imports", "references"],
    maxDepth: 4,
    maxPaths: 8,
  });

  assert.equal(result.paths.length, 3);
  assert.deepEqual(result.paths.map((path) => path.hops.length), [1, 2, 2]);
  assert.deepEqual(result.paths[0]!.nodes.map((item) => item.id), [route.id, library.id]);
  const longer = result.paths.slice(1).map((path) => path.nodes.map((item) => item.id).join("|"));
  assert.ok(longer.includes([route.id, primary.id, library.id].join("|")));
  assert.ok(longer.includes([route.id, secondary.id, library.id].join("|")));
  assert.ok(result.paths.every((path) => path.nodes.every((item) => !Object.hasOwn(item, "identity") && !Object.hasOwn(item, "evidence"))));
  assert.equal(result.truncated, false);
  assert.deepEqual(result.execution, {
    networkAccess: false,
    writeAccess: false,
    maxDepth: 4,
    maxPaths: 8,
    maxStates: 2_000,
  });
});

test("dependent alternatives preserve graph-edge orientation separately from traversal orientation", () => {
  const { graph, library, primary, secondary, route } = parsedFixture();
  const result = findSolveGraphAlternativePaths(graph, library.id, route.id, {
    direction: "dependents",
    edgeKinds: ["imports", "calls"],
  });

  assert.equal(result.paths.length, 3);
  assert.deepEqual(result.paths[0]!.nodes.map((item) => item.id), [library.id, route.id]);
  const twoHop = result.paths.filter((path) => path.hops.length === 2);
  assert.equal(twoHop.length, 2);
  assert.ok(twoHop.some((path) => path.nodes.map((item) => item.id).join("|") === [library.id, primary.id, route.id].join("|")));
  assert.ok(twoHop.some((path) => path.nodes.map((item) => item.id).join("|") === [library.id, secondary.id, route.id].join("|")));
  assert.ok(result.paths.every((path) => path.hops.every((hop) => {
    if (hop.edgeKind === "imports" || hop.edgeKind === "calls") {
      return hop.edgeToId === hop.traversalFromId && hop.edgeFromId === hop.traversalToId;
    }
    return true;
  })));
});

test("path, depth, and traversal-state bounds report uncertainty explicitly", () => {
  const { graph, library, route } = parsedFixture();

  const pathBound = findSolveGraphAlternativePaths(graph, route.id, library.id, {
    edgeKinds: ["calls", "imports"],
    maxPaths: 1,
  });
  assert.equal(pathBound.paths.length, 1);
  assert.equal(pathBound.truncated, true);
  assert.equal(pathBound.truncationReason, "path-count");

  const depthBound = findSolveGraphAlternativePaths(graph, route.id, library.id, {
    edgeKinds: ["calls", "imports"],
    maxDepth: 1,
    maxPaths: 8,
  });
  assert.equal(depthBound.paths.length, 1);
  assert.equal(depthBound.truncated, true);
  assert.equal(depthBound.truncationReason, "depth");

  const stateBound = findSolveGraphAlternativePaths(graph, route.id, library.id, {
    edgeKinds: ["calls", "imports"],
    maxStates: 1,
  });
  assert.equal(stateBound.paths.length, 0);
  assert.equal(stateBound.truncated, true);
  assert.equal(stateBound.truncationReason, "state-count");
});

test("zero-hop, filtered no-path, and invalid inputs fail closed", () => {
  const { graph, library, route, routeTest } = parsedFixture();
  const same = findSolveGraphAlternativePaths(graph, library.id, library.id);
  assert.equal(same.paths.length, 1);
  assert.deepEqual(same.paths[0]!.nodes.map((item) => item.id), [library.id]);
  assert.deepEqual(same.paths[0]!.hops, []);

  const filtered = findSolveGraphAlternativePaths(graph, route.id, routeTest.id, { edgeKinds: ["calls", "imports"] });
  assert.deepEqual(filtered.paths, []);
  assert.equal(filtered.truncated, false);

  assert.throws(() => findSolveGraphAlternativePaths(graph, "missing", library.id), /source does not exist/);
  assert.throws(() => findSolveGraphAlternativePaths(graph, route.id, "missing"), /target does not exist/);
  assert.throws(() => findSolveGraphAlternativePaths(graph, route.id, library.id, { direction: "sideways" as never }), /direction is invalid/);
  assert.throws(() => findSolveGraphAlternativePaths(graph, route.id, library.id, { edgeKinds: ["bad" as never] }), /edge kind is invalid/);
  assert.throws(() => findSolveGraphAlternativePaths(graph, route.id, library.id, { maxDepth: 33 }), /maxDepth/);
  assert.throws(() => findSolveGraphAlternativePaths(graph, route.id, library.id, { maxPaths: 0 }), /maxPaths/);
  assert.throws(() => findSolveGraphAlternativePaths(graph, route.id, library.id, { maxStates: 0 }), /maxStates/);
});
