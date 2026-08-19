import assert from "node:assert/strict";
import test from "node:test";

import type { RepositoryAuditVisualExplorer } from "./visualExplorer";
import { createRepositoryAuditVisualExplorerPresentation } from "./visualExplorerPresentation";

function fixtureExplorer(): RepositoryAuditVisualExplorer {
  return {
    schema: "solvelang.repository-audit.visual-explorer.v0",
    mode: "analyze-only",
    graphId: "graph-visual-fixture",
    status: "complete",
    nodes: [
      { id: "route", kind: "route", label: "GET /health", path: "src/routes.ts", incoming: 0, outgoing: 2 },
      { id: "permission", kind: "permission", label: "read-health", path: "infra/policy.yml", incoming: 1, outgoing: 0 },
      { id: "resource", kind: "resource", label: "health-service", path: "infra/service.yml", incoming: 1, outgoing: 1 },
      { id: "function", kind: "function", label: "healthHandler", path: "src/health.ts", incoming: 1, outgoing: 0 },
      { id: "file", kind: "file", label: "worker.ts", path: "src/worker.ts", incoming: 0, outgoing: 0 },
    ],
    edges: [
      { id: "route-resource", kind: "deploys", from: "route", to: "resource" },
      { id: "resource-permission", kind: "grants", from: "resource", to: "permission" },
      { id: "route-function", kind: "calls", from: "route", to: "function" },
    ],
    summary: {
      nodesObserved: 5,
      nodesShown: 5,
      nodesHidden: 0,
      edgesObserved: 3,
      edgesShown: 3,
      edgesHidden: 0,
      securityBoundaryNodesShown: 2,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxNodes: 300,
      maxEdges: 600,
      nodesTruncated: false,
      edgesTruncated: false,
      graphPartial: false,
    },
  };
}

test("creates deterministic browser-ready filtering without mutating source evidence", () => {
  const source = fixtureExplorer();
  const before = structuredClone(source);
  const first = createRepositoryAuditVisualExplorerPresentation(source, {
    query: "HEALTH",
    kinds: ["function", "resource", "route", "permission", "resource"],
  });
  const second = createRepositoryAuditVisualExplorerPresentation(structuredClone(source), {
    query: " health ",
    kinds: ["permission", "route", "resource", "function"],
  });

  assert.deepEqual(first, second);
  assert.deepEqual(source, before);
  assert.equal(first.schema, "solvelang.repository-audit.visual-explorer-presentation.v0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.query, "health");
  assert.deepEqual(first.kinds, ["function", "permission", "resource", "route"]);
  assert.deepEqual(first.nodes.map((node) => node.id), ["route", "permission", "resource", "function"]);
  assert.equal(first.summary.hiddenNodesByFilter, 1);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
});

test("prioritizes a visible selection and reports only shown direct neighbors", () => {
  const result = createRepositoryAuditVisualExplorerPresentation(fixtureExplorer(), {
    selectedNodeId: "resource",
    maxNodes: 4,
    maxEdges: 2,
  });

  assert.equal(result.nodes[0]?.id, "resource");
  assert.equal(result.nodes[0]?.selected, true);
  assert.deepEqual(result.edges.map((edge) => edge.id), ["route-resource", "resource-permission"]);
  assert.deepEqual(
    result.nodes.filter((node) => node.directNeighbor).map((node) => node.id).sort(),
    ["permission", "route"],
  );
  assert.equal(result.summary.selectedNodeFound, true);
  assert.equal(result.summary.selectedNodeShown, true);
  assert.equal(result.summary.directNeighborsShown, 2);
  assert.equal(result.summary.hiddenNodesByLimit, 1);
  assert.equal(result.status, "partial");
});

test("keeps filtering distinct from truncation and preserves source partial truth", () => {
  const source = fixtureExplorer();
  const filtered = createRepositoryAuditVisualExplorerPresentation(source, { kinds: ["route"] });
  assert.equal(filtered.summary.hiddenNodesByFilter, 4);
  assert.equal(filtered.execution.nodesTruncated, false);
  assert.equal(filtered.status, "complete");

  source.status = "partial";
  source.execution.graphPartial = true;
  const partial = createRepositoryAuditVisualExplorerPresentation(source, { kinds: ["route"] });
  assert.equal(partial.status, "partial");
  assert.equal(partial.execution.sourcePartial, true);
});

test("reports missing selections without inventing nodes or relationships", () => {
  const result = createRepositoryAuditVisualExplorerPresentation(fixtureExplorer(), {
    selectedNodeId: "missing-node",
    query: "worker",
  });

  assert.equal(result.summary.selectedNodeFound, false);
  assert.equal(result.summary.selectedNodeShown, false);
  assert.equal(result.summary.directNeighborsShown, 0);
  assert.deepEqual(result.nodes.map((node) => node.id), ["file"]);
  assert.deepEqual(result.edges, []);
});

test("fails closed on malformed explorer contracts and invalid browser bounds", () => {
  const mutable = fixtureExplorer();
  (mutable.execution as { networkAccess: boolean }).networkAccess = true;
  assert.throws(
    () => createRepositoryAuditVisualExplorerPresentation(mutable),
    /rejects mutable or network-enabled explorer documents/,
  );

  const badEdge = fixtureExplorer();
  badEdge.edges[0] = { ...badEdge.edges[0]!, to: "missing" };
  assert.throws(
    () => createRepositoryAuditVisualExplorerPresentation(badEdge),
    /edges with visible explorer endpoints/,
  );

  assert.throws(
    () => createRepositoryAuditVisualExplorerPresentation(fixtureExplorer(), { maxNodes: 0 }),
    /maxNodes must be an integer/,
  );
  assert.throws(
    () => createRepositoryAuditVisualExplorerPresentation(fixtureExplorer(), { maxEdges: 2_001 }),
    /maxEdges must be an integer/,
  );
  assert.throws(
    () => createRepositoryAuditVisualExplorerPresentation(fixtureExplorer(), { query: "x".repeat(257) }),
    /query must be at most 256 UTF-8 bytes/,
  );
  assert.throws(
    () => createRepositoryAuditVisualExplorerPresentation(fixtureExplorer(), { kinds: Array(17).fill("file") }),
    /kinds must contain at most 16 entries/,
  );
});
