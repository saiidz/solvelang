import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  SOLVE_GRAPH_SCHEMA,
  canonicalSolveGraphJson,
  executeSolveGraphTool,
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
  const repository = node("repository", "repo:fixture", "Fixture repository", "README.md");
  const api = node("file", "file:src/api.ts", "src/api.ts", "src/api.ts");
  const store = node("file", "file:src/store.ts", "src/store.ts", "src/store.ts");
  const apiTest = node("test", "test:test/api.test.ts", "test/api.test.ts", "test/api.test.ts");
  const nodes = [repository, api, store, apiTest].sort((left, right) => left.id.localeCompare(right.id));
  const edges = [
    edge("contains", repository.id, api.id, "src/api.ts"),
    edge("contains", repository.id, store.id, "src/store.ts"),
    edge("imports", api.id, store.id, "src/api.ts"),
    edge("tests", apiTest.id, api.id, "test/api.test.ts"),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const source = {
    kind: "repository" as const,
    displayName: "fixture",
    fingerprint: `sha256:${"a".repeat(64)}`,
    revision: "test",
    private: true,
  };
  const extractors = [{ id: "fixture", version: "1", deterministic: true as const }];
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
    engineVersion: "0.1.0",
    extractors,
    limits,
  }).slice(0, 32)}`;
  const withoutIntegrity = {
    schema: SOLVE_GRAPH_SCHEMA,
    graphId,
    mode: "analyze-only" as const,
    engine: { name: "SolveLang Solve Graph", version: "0.1.0", deterministic: true as const },
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

test("integrity-valid analyze-only Solve Graph documents are accepted", () => {
  const graph = graphFixture();
  const parsed = parseSolveGraphText(JSON.stringify(graph));
  assert.equal(parsed.graphId, graph.graphId);
  assert.equal(parsed.nodes.length, 4);
  assert.equal(parsed.edges.length, 4);
});

test("find_nodes returns only bounded safe node summaries", () => {
  const graph = parseSolveGraphText(JSON.stringify(graphFixture()));
  const response = executeSolveGraphTool(graph, {
    tool: "solve_graph.find_nodes",
    query: { kinds: ["file"], text: "src/", limit: 1 },
  });
  assert.equal(response.tool, "solve_graph.find_nodes");
  assert.equal(response.nodes.length, 1);
  assert.equal(response.nodes[0].kind, "file");
  assert.equal(response.truncated, true);
  assert.deepEqual(Object.keys(response.nodes[0]).sort(), ["id", "kind", "label", "path"]);
});

test("dependency and dependent traversal are deterministic and edge-filterable", () => {
  const graph = parseSolveGraphText(JSON.stringify(graphFixture()));
  const api = graph.nodes.find((item) => item.identity === "file:src/api.ts")!;
  const store = graph.nodes.find((item) => item.identity === "file:src/store.ts")!;

  const dependencies = executeSolveGraphTool(graph, {
    tool: "solve_graph.dependencies",
    rootIds: [api.id],
    options: { edgeKinds: ["imports"] },
  });
  assert.equal(dependencies.tool, "solve_graph.dependencies");
  assert.deepEqual(dependencies.entries.map((entry) => entry.node.id), [api.id, store.id]);
  assert.equal(dependencies.entries[1].viaEdgeKind, "imports");

  const dependents = executeSolveGraphTool(graph, {
    tool: "solve_graph.dependents",
    rootIds: [store.id],
    options: { edgeKinds: ["imports"] },
  });
  assert.equal(dependents.tool, "solve_graph.dependents");
  assert.deepEqual(dependents.entries.map((entry) => entry.node.id), [store.id, api.id]);
});

test("impact traversal excludes containment noise and includes transitive test impact", () => {
  const graph = parseSolveGraphText(JSON.stringify(graphFixture()));
  const store = graph.nodes.find((item) => item.identity === "file:src/store.ts")!;
  const api = graph.nodes.find((item) => item.identity === "file:src/api.ts")!;
  const apiTest = graph.nodes.find((item) => item.kind === "test")!;

  const impact = executeSolveGraphTool(graph, { tool: "solve_graph.impact", changedNodeIds: [store.id] });
  assert.equal(impact.tool, "solve_graph.impact");
  assert.deepEqual(impact.entries.map((entry) => entry.node.id), [store.id, api.id, apiTest.id]);
  assert.ok(impact.entries.every((entry) => entry.viaEdgeKind !== "contains"));
});

test("tampered, mutable-capability, and unstable-ID graphs fail closed", () => {
  const tampered = graphFixture();
  tampered.nodes[0] = { ...tampered.nodes[0], label: "tampered" };
  assert.throws(() => parseSolveGraphText(JSON.stringify(tampered)), /integrity verification failed/);

  const networkEnabled = graphFixture();
  const rawNetwork = JSON.stringify({ ...networkEnabled, execution: { ...networkEnabled.execution, networkAccess: true } });
  assert.throws(() => parseSolveGraphText(rawNetwork), /networkAccess=false/);

  const unstable = graphFixture();
  const changedNodes = unstable.nodes.map((item, index) => index === 0 ? { ...item, id: `sgn_${"0".repeat(32)}` } : item);
  const withoutIntegrity = { ...unstable, nodes: changedNodes } as Record<string, unknown>;
  delete withoutIntegrity.integrity;
  const rawUnstable = JSON.stringify({
    ...withoutIntegrity,
    integrity: {
      canonicalJsonSha256: `sha256:${digest({ ...withoutIntegrity, integrity: { stableIds: true, ordering: "id-ascending" } })}`,
      stableIds: true,
      ordering: "id-ascending",
    },
  });
  assert.throws(() => parseSolveGraphText(rawUnstable), /node ID does not match its identity/);
});

test("query bounds and root existence fail closed", () => {
  const graph = parseSolveGraphText(JSON.stringify(graphFixture()));
  assert.throws(
    () => executeSolveGraphTool(graph, { tool: "solve_graph.find_nodes", query: { limit: 10_001 } }),
    /query limit/,
  );
  assert.throws(
    () => executeSolveGraphTool(graph, { tool: "solve_graph.dependencies", rootIds: [`sgn_${"f".repeat(32)}`] }),
    /root does not exist/,
  );
  const api = graph.nodes.find((item) => item.identity === "file:src/api.ts")!;
  const bounded = executeSolveGraphTool(graph, {
    tool: "solve_graph.dependencies",
    rootIds: [api.id],
    options: { edgeKinds: ["imports"], maxDepth: 0 },
  });
  assert.equal(bounded.tool, "solve_graph.dependencies");
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.truncationReason, "depth");
});
