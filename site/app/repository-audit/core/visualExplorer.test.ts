import assert from "node:assert/strict";
import test from "node:test";

import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "../../solve-graph/core/canonical";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import { createRepositoryAuditVisualExplorer } from "./visualExplorer";

async function fixtureGraph() {
  const repository = await createSolveGraphNode({
    kind: "repository",
    identity: "repo:visual",
    label: "Visual repository",
    evidence: [{ kind: "deterministic-analysis", path: "README.md" }],
  });
  const file = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/app.ts",
    label: "app.ts",
    evidence: [{ kind: "parser", path: "src/app.ts", line: 1 }],
    metadata: { path: "src/app.ts", language: "typescript" },
  });
  const route = await createSolveGraphNode({
    kind: "route",
    identity: "route:GET:/health",
    label: "GET /health",
    evidence: [{ kind: "configuration", path: "src/routes.ts", line: 4 }],
  });
  const resource = await createSolveGraphNode({
    kind: "resource",
    identity: "resource:health-service",
    label: "health-service",
    evidence: [{ kind: "configuration", path: "infra/service.yml", line: 2 }],
  });
  const permission = await createSolveGraphNode({
    kind: "permission",
    identity: "permission:read-health",
    label: "read-health",
    evidence: [{ kind: "configuration", path: "infra/policy.yml", line: 8 }],
  });

  const edges = [
    await createSolveGraphEdge({
      kind: "contains",
      from: repository.id,
      to: file.id,
      evidence: [{ kind: "deterministic-analysis", path: "src/app.ts" }],
    }),
    await createSolveGraphEdge({
      kind: "calls",
      from: route.id,
      to: file.id,
      evidence: [{ kind: "parser", path: "src/routes.ts", line: 4 }],
    }),
    await createSolveGraphEdge({
      kind: "deploys",
      from: route.id,
      to: resource.id,
      evidence: [{ kind: "configuration", path: "infra/service.yml", line: 2 }],
    }),
    await createSolveGraphEdge({
      kind: "grants",
      from: resource.id,
      to: permission.id,
      evidence: [{ kind: "configuration", path: "infra/policy.yml", line: 8 }],
    }),
  ];

  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "visual-explorer-fixture", version: "1", deterministic: true }],
    nodes: [repository, file, route, resource, permission],
    edges,
  });
  return { document, route, resource, permission };
}

test("creates a deterministic bounded explorer with safe node summaries and degrees", async () => {
  const { document, route, resource, permission } = await fixtureGraph();
  const first = await createRepositoryAuditVisualExplorer(document);
  const second = await createRepositoryAuditVisualExplorer(structuredClone(document));

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.visual-explorer.v0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.status, "complete");
  assert.deepEqual(first.nodes.slice(0, 3).map((node) => node.id), [route.id, permission.id, resource.id]);
  assert.equal(first.nodes.find((node) => node.id === route.id)?.outgoing, 2);
  assert.equal(first.summary.securityBoundaryNodesShown, 2);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.equal("identity" in first.nodes[0]!, false);
  assert.equal("metadata" in first.nodes[0]!, false);
});

test("reports node and edge truncation as partial without inventing hidden relationships", async () => {
  const { document } = await fixtureGraph();
  const result = await createRepositoryAuditVisualExplorer(document, { maxNodes: 3, maxEdges: 1 });

  assert.equal(result.status, "partial");
  assert.equal(result.nodes.length, 3);
  assert.equal(result.execution.nodesTruncated, true);
  assert.equal(result.edges.length <= 1, true);
  assert.equal(result.summary.nodesHidden, 2);
  assert.equal(result.summary.edgesHidden, document.edges.length - result.edges.length);
  assert.equal(result.edges.every((edge) => result.nodes.some((node) => node.id === edge.from) && result.nodes.some((node) => node.id === edge.to)), true);
});

test("rejects integrity-invalid graphs and invalid bounds", async () => {
  const { document } = await fixtureGraph();
  const tampered = structuredClone(document);
  tampered.nodes[0]!.label = "tampered";

  await assert.rejects(createRepositoryAuditVisualExplorer(tampered), /integrity-valid canonical document/);
  await assert.rejects(createRepositoryAuditVisualExplorer(document, { maxNodes: 0 }), /maxNodes must be an integer/);
  await assert.rejects(createRepositoryAuditVisualExplorer(document, { maxEdges: 5_001 }), /maxEdges must be an integer/);
});
