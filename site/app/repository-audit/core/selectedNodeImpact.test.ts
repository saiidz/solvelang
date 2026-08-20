import assert from "node:assert/strict";
import test from "node:test";

import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "../../solve-graph/core/canonical";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import { createSolveGraphQueryIndex } from "../../solve-graph/core/query-impact";
import { createRepositoryAuditSelectedNodeImpactProduct } from "./selectedNodeImpact";
import { createRepositoryAuditVisualExplorer } from "./visualExplorer";

async function fixture(suffix: string) {
  const changed = await createSolveGraphNode({
    kind: "file",
    identity: `file:src/config-${suffix}.ts`,
    label: `config-${suffix}.ts`,
    evidence: [{ kind: "parser", path: `src/config-${suffix}.ts`, line: 1 }],
    metadata: { path: `src/config-${suffix}.ts`, language: "typescript" },
  });
  const dependent = await createSolveGraphNode({
    kind: "file",
    identity: `file:src/app-${suffix}.ts`,
    label: `app-${suffix}.ts`,
    evidence: [{ kind: "parser", path: `src/app-${suffix}.ts`, line: 1 }],
    metadata: { path: `src/app-${suffix}.ts`, language: "typescript" },
  });
  const edge = await createSolveGraphEdge({
    kind: "imports",
    from: dependent.id,
    to: changed.id,
    evidence: [{ kind: "parser", path: `src/app-${suffix}.ts`, line: 1 }],
  });
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: `selected-impact-${suffix}`, version: "1", deterministic: true }],
    nodes: [changed, dependent],
    edges: [edge],
  });
  const explorer = await createRepositoryAuditVisualExplorer(document);
  const index = await createSolveGraphQueryIndex(document);
  return { changed, dependent, document, explorer, index };
}

test("composes bounded selected-node impact from the canonical graph", async () => {
  const { changed, dependent, explorer, index } = await fixture("primary");
  const product = createRepositoryAuditSelectedNodeImpactProduct(explorer, index, changed.id, {
    maxDepth: 4,
    maxResults: 20,
    maxRows: 10,
  });

  assert.ok(product);
  assert.equal(product.graphId, explorer.graphId);
  assert.deepEqual(product.request.changedNodeIds, [changed.id]);
  assert.equal(product.request.maxDepth, 4);
  assert.equal(product.request.maxResults, 20);
  assert.equal(product.request.presentationMaxRows, 10);
  assert.equal(product.query.entries.some((entry) => entry.id === dependent.id), true);
  assert.equal(product.execution.networkAccess, false);
  assert.equal(product.execution.writeAccess, false);
});

test("returns no impact product for an empty or stale explorer selection", async () => {
  const { explorer, index } = await fixture("stale");

  assert.equal(createRepositoryAuditSelectedNodeImpactProduct(explorer, index, undefined), undefined);
  assert.equal(createRepositoryAuditSelectedNodeImpactProduct(explorer, index, "node-from-previous-scan"), undefined);
});

test("rejects an impact index from a different canonical graph", async () => {
  const primary = await fixture("graph-a");
  const secondary = await fixture("graph-b");

  assert.throws(
    () => createRepositoryAuditSelectedNodeImpactProduct(primary.explorer, secondary.index, primary.changed.id),
    /impact index must match the explorer graph/,
  );
});
