import assert from "node:assert/strict";
import test from "node:test";

import { explainSolveGraphShortestPath } from "../src/solve-graph-shortest-path-explanation.js";
import { SOLVE_GRAPH_SCHEMA, type SolveGraphDocument } from "../src/solve-graph.js";

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

test("composes deterministic bounded dependency explanations from graph input", () => {
  const first = explainSolveGraphShortestPath(fixture(), sourceId, targetId, {
    edgeKinds: ["imports", "calls"],
    maxDepth: 4,
    maxVisited: 10,
  });
  const second = explainSolveGraphShortestPath(fixture(), sourceId, targetId, {
    edgeKinds: ["imports", "calls"],
    maxDepth: 4,
    maxVisited: 10,
  });

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.mcp.solve-graph.shortest-path-explanation.v0");
  assert.equal(first.status, "complete");
  assert.equal(first.headline, "Dependency path found");
  assert.deepEqual(first.steps.map((step) => step.sentence), [
    "src/a.ts --imports--> src/b.ts",
    "src/b.ts --calls--> src/c.ts",
  ]);
  assert.deepEqual(first.execution, {
    networkAccess: false,
    writeAccess: false,
    queryTruncated: false,
  });
});

test("preserves dependent traversal orientation and safe structural output", () => {
  const result = explainSolveGraphShortestPath(fixture(), targetId, sourceId, {
    direction: "dependents",
    edgeKinds: ["imports", "calls"],
  });

  assert.equal(result.found, true);
  assert.equal(result.headline, "Dependent path found");
  assert.deepEqual(result.steps.map((step) => [step.from.id, step.to.id]), [
    [targetId, middleId],
    [middleId, sourceId],
  ]);
  assert.ok(result.steps.every((step) => !Object.hasOwn(step.from, "identity") && !Object.hasOwn(step.to, "evidence")));
});

test("surfaces bounded-search uncertainty without claiming absence", () => {
  const result = explainSolveGraphShortestPath(fixture(), sourceId, targetId, {
    edgeKinds: ["imports", "calls"],
    maxDepth: 1,
  });

  assert.equal(result.found, false);
  assert.equal(result.status, "partial");
  assert.equal(result.execution.queryTruncated, true);
  assert.equal(result.steps.length, 0);
  assert.match(result.detail, /absence is not proven/);
  assert.match(result.notices[0] ?? "", /depth bound/);
});

test("supports zero-hop paths and rejects capability-bearing documents", () => {
  const same = explainSolveGraphShortestPath(fixture(), sourceId, sourceId);
  assert.equal(same.found, true);
  assert.equal(same.summary.hopCount, 0);
  assert.equal(same.headline, "Source and target are the same node");

  const unsafe = fixture() as SolveGraphDocument & { execution: { networkAccess: boolean; writeAccess: false } };
  unsafe.execution.networkAccess = true;
  assert.throws(
    () => explainSolveGraphShortestPath(unsafe as SolveGraphDocument, sourceId, targetId),
    /requires an analyze-only document/,
  );
});
