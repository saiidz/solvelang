import assert from "node:assert/strict";
import test from "node:test";

import {
  createSolveGraphImpactExplanation,
  explainSolveGraphImpact,
} from "../src/solve-graph-impact-explanation.js";
import {
  executeSolveGraphTool,
  SOLVE_GRAPH_SCHEMA,
  type SolveGraphDocument,
} from "../src/solve-graph.js";

const sourceId = `sgn_${"1".repeat(32)}`;
const middleId = `sgn_${"2".repeat(32)}`;
const targetId = `sgn_${"3".repeat(32)}`;

function fixture(): SolveGraphDocument {
  return {
    schema: SOLVE_GRAPH_SCHEMA,
    graphId: `sg_${"f".repeat(32)}`,
    mode: "analyze-only",
    engine: { name: "SolveLang Solve Graph", version: "0.2.0", deterministic: true },
    source: { fingerprint: `sha256:${"a".repeat(64)}` },
    extractors: [],
    limits: {},
    execution: { networkAccess: false, writeAccess: false },
    nodes: [
      {
        id: sourceId,
        kind: "file",
        identity: "file:src/a.ts",
        label: "src/a.ts",
        evidence: [{ path: "src/a.ts" }],
        metadata: { path: "src/a.ts" },
      },
      {
        id: middleId,
        kind: "file",
        identity: "file:src/b.ts",
        label: "src/b.ts",
        evidence: [{ path: "src/b.ts" }],
        metadata: { path: "src/b.ts" },
      },
      {
        id: targetId,
        kind: "file",
        identity: "file:src/c.ts",
        label: "src/c.ts",
        evidence: [{ path: "src/c.ts" }],
        metadata: { path: "src/c.ts" },
      },
    ],
    edges: [
      {
        id: `sge_${"a".repeat(32)}`,
        kind: "imports",
        from: sourceId,
        to: middleId,
        evidence: [{ path: "src/a.ts" }],
      },
      {
        id: `sge_${"b".repeat(32)}`,
        kind: "calls",
        from: middleId,
        to: targetId,
        evidence: [{ path: "src/b.ts" }],
      },
    ],
    integrity: {
      canonicalJsonSha256: `sha256:${"0".repeat(64)}`,
      stableIds: true,
      ordering: "id-ascending",
    },
  };
}

test("composes deterministic complete impact explanations from bounded traversal evidence", () => {
  const first = explainSolveGraphImpact(fixture(), [targetId], {
    edgeKinds: ["imports", "calls"],
    maxDepth: 4,
    maxResults: 10,
  });
  const second = explainSolveGraphImpact(fixture(), [targetId], {
    edgeKinds: ["imports", "calls"],
    maxDepth: 4,
    maxResults: 10,
  });

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.mcp.solve-graph.impact-explanation.v0");
  assert.equal(first.status, "complete");
  assert.equal(first.summary.impactedNodes, 2);
  assert.equal(first.summary.maximumObservedDepth, 2);
  assert.deepEqual(first.rows.map((row) => row.sentence), [
    "src/b.ts is within 1 dependent hop of src/c.ts.",
    "src/a.ts is within 2 dependent hops of src/c.ts.",
  ]);
  assert.deepEqual(first.rows[1]!.steps.map((step) => step.sentence), [
    "src/b.ts --calls--> src/c.ts",
    "src/a.ts --imports--> src/b.ts",
  ]);
  assert.deepEqual(first.execution, {
    networkAccess: false,
    writeAccess: false,
    queryTruncated: false,
    presentationTruncated: false,
    maxRows: 100,
  });
});

test("keeps query truncation distinct from presentation truncation", () => {
  const depthBounded = explainSolveGraphImpact(fixture(), [targetId], {
    edgeKinds: ["imports", "calls"],
    maxDepth: 1,
    maxResults: 10,
  });
  assert.equal(depthBounded.status, "partial");
  assert.equal(depthBounded.execution.queryTruncated, true);
  assert.equal(depthBounded.execution.presentationTruncated, false);
  assert.match(depthBounded.notices[0] ?? "", /depth bound/);

  const presentationBounded = explainSolveGraphImpact(fixture(), [targetId], {
    edgeKinds: ["imports", "calls"],
    maxRows: 1,
  });
  assert.equal(presentationBounded.status, "partial");
  assert.equal(presentationBounded.execution.queryTruncated, false);
  assert.equal(presentationBounded.execution.presentationTruncated, true);
  assert.equal(presentationBounded.summary.impactedNodes, 2);
  assert.equal(presentationBounded.summary.explainedNodes, 1);
  assert.equal(presentationBounded.summary.hiddenNodes, 1);
  assert.match(presentationBounded.notices[0] ?? "", /bounded subset/);
});

test("states complete no-impact truth only after a complete traversal", () => {
  const result = explainSolveGraphImpact(fixture(), [sourceId], {
    edgeKinds: ["imports", "calls"],
  });

  assert.equal(result.status, "complete");
  assert.equal(result.summary.impactedNodes, 0);
  assert.equal(result.headline, "No impacted dependent nodes found");
  assert.match(result.detail, /completely searched configured graph scope/);
});

test("rejects capability-bearing documents and tampered traversal evidence", () => {
  const unsafe = fixture() as unknown as { execution: { networkAccess: boolean; writeAccess: boolean } };
  unsafe.execution.networkAccess = true;
  assert.throws(
    () => explainSolveGraphImpact(unsafe as unknown as SolveGraphDocument, [targetId]),
    /capability-free document/,
  );

  const document = fixture();
  const response = executeSolveGraphTool(document, {
    tool: "solve_graph.impact",
    changedNodeIds: [targetId],
    options: { edgeKinds: ["imports", "calls"] },
  });
  assert.equal(response.tool, "solve_graph.impact");
  if (response.tool !== "solve_graph.impact") throw new Error("unexpected fixture response");
  response.entries[1]!.viaEdgeKind = "imports";
  assert.throws(
    () => createSolveGraphImpactExplanation(document, response),
    /edge traversal is invalid/,
  );
});
