import assert from "node:assert/strict";
import test from "node:test";

import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "../../solve-graph/core/canonical";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import { createSolveGraphQueryIndex } from "../../solve-graph/core/query-impact";
import { createRepositoryAuditImpactExplanationProduct } from "./impactExplanationProduct";

async function fixture() {
  const root = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/root.ts",
    label: "root.ts",
    evidence: [{ kind: "parser", path: "src/root.ts" }],
    metadata: { path: "src/root.ts" },
  });
  const direct = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/direct.ts",
    label: "direct.ts",
    evidence: [{ kind: "parser", path: "src/direct.ts" }],
    metadata: { path: "src/direct.ts" },
  });
  const transitive = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/transitive.ts",
    label: "transitive.ts",
    evidence: [{ kind: "parser", path: "src/transitive.ts" }],
    metadata: { path: "src/transitive.ts" },
  });

  const directEdge = await createSolveGraphEdge({
    kind: "imports",
    from: direct.id,
    to: root.id,
    evidence: [{ kind: "parser", path: "src/direct.ts" }],
  });
  const transitiveEdge = await createSolveGraphEdge({
    kind: "calls",
    from: transitive.id,
    to: direct.id,
    evidence: [{ kind: "parser", path: "src/transitive.ts" }],
  });

  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "repository-audit-impact-product-fixture", version: "1", deterministic: true }],
    nodes: [transitive, root, direct],
    edges: [transitiveEdge, directEdge],
  });

  return {
    index: await createSolveGraphQueryIndex(document),
    root,
    direct,
    transitive,
  };
}

test("builds a deterministic analyze-only impact explanation product", async () => {
  const { index, root, direct, transitive } = await fixture();

  const first = createRepositoryAuditImpactExplanationProduct(index, root.id);
  const second = createRepositoryAuditImpactExplanationProduct(index, root.id);

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.impact-explanation-product.v0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.selectedNode.id, root.id);
  assert.equal(first.explanation.status, "complete");
  assert.equal(first.explanation.summary.impactedNodes, 2);
  assert.deepEqual(first.explanation.rows.map((row) => row.node.id), [direct.id, transitive.id]);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
});

test("keeps query and presentation truncation truth separate", async () => {
  const { index, root } = await fixture();

  const depthBound = createRepositoryAuditImpactExplanationProduct(index, root.id, { maxDepth: 1 });
  assert.equal(depthBound.explanation.status, "partial");
  assert.equal(depthBound.explanation.execution.queryTruncated, true);
  assert.equal(depthBound.explanation.execution.presentationTruncated, false);

  const rowBound = createRepositoryAuditImpactExplanationProduct(index, root.id, { maxRows: 1 });
  assert.equal(rowBound.explanation.status, "partial");
  assert.equal(rowBound.explanation.execution.queryTruncated, false);
  assert.equal(rowBound.explanation.execution.presentationTruncated, true);
  assert.equal(rowBound.explanation.summary.hiddenNodes, 1);
});

test("reports complete no-impact truth only after complete traversal", async () => {
  const { index, transitive } = await fixture();
  const product = createRepositoryAuditImpactExplanationProduct(index, transitive.id);

  assert.equal(product.explanation.status, "complete");
  assert.equal(product.explanation.summary.impactedNodes, 0);
  assert.equal(product.explanation.headline, "No impacted dependent nodes found");
});

test("rejects a selected node outside the canonical graph", async () => {
  const { index } = await fixture();
  assert.throws(
    () => createRepositoryAuditImpactExplanationProduct(index, "sgn_missing"),
    /selected node does not exist/,
  );
});
