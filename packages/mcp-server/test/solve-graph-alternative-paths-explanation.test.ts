import assert from "node:assert/strict";
import test from "node:test";

import {
  createSolveGraphAlternativePathsExplanation,
  explainSolveGraphAlternativePaths,
  findSolveGraphAlternativePaths,
} from "../src/solve-graph-alternative-paths.js";
import { SOLVE_GRAPH_SCHEMA, type SolveGraphDocument } from "../src/solve-graph.js";

const sourceId = `sgn_${"1".repeat(32)}`;
const firstId = `sgn_${"2".repeat(32)}`;
const secondId = `sgn_${"3".repeat(32)}`;
const targetId = `sgn_${"4".repeat(32)}`;
const isolatedId = `sgn_${"5".repeat(32)}`;

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
      { id: sourceId, kind: "file", identity: "file:src/source.ts", label: "src/source.ts", evidence: [{ path: "src/source.ts" }], metadata: { path: "src/source.ts" } },
      { id: firstId, kind: "file", identity: "file:src/first.ts", label: "src/first.ts", evidence: [{ path: "src/first.ts" }], metadata: { path: "src/first.ts" } },
      { id: secondId, kind: "file", identity: "file:src/second.ts", label: "src/second.ts", evidence: [{ path: "src/second.ts" }], metadata: { path: "src/second.ts" } },
      { id: targetId, kind: "file", identity: "file:src/target.ts", label: "src/target.ts", evidence: [{ path: "src/target.ts" }], metadata: { path: "src/target.ts" } },
      { id: isolatedId, kind: "file", identity: "file:src/isolated.ts", label: "src/isolated.ts", evidence: [{ path: "src/isolated.ts" }], metadata: { path: "src/isolated.ts" } },
    ],
    edges: [
      { id: `sge_${"a".repeat(32)}`, kind: "imports", from: sourceId, to: targetId, evidence: [{ path: "src/source.ts" }] },
      { id: `sge_${"b".repeat(32)}`, kind: "calls", from: sourceId, to: firstId, evidence: [{ path: "src/source.ts" }] },
      { id: `sge_${"c".repeat(32)}`, kind: "imports", from: firstId, to: targetId, evidence: [{ path: "src/first.ts" }] },
      { id: `sge_${"d".repeat(32)}`, kind: "calls", from: sourceId, to: secondId, evidence: [{ path: "src/source.ts" }] },
      { id: `sge_${"e".repeat(32)}`, kind: "imports", from: secondId, to: targetId, evidence: [{ path: "src/second.ts" }] },
    ],
    integrity: {
      canonicalJsonSha256: `sha256:${"0".repeat(64)}`,
      stableIds: true,
      ordering: "id-ascending",
    },
  };
}

test("explains complete alternative paths deterministically from shortest to longer", () => {
  const first = explainSolveGraphAlternativePaths(fixture(), sourceId, targetId, {
    edgeKinds: ["calls", "imports"],
    maxDepth: 4,
    maxPaths: 8,
  });
  const second = explainSolveGraphAlternativePaths(fixture(), sourceId, targetId, {
    edgeKinds: ["calls", "imports"],
    maxDepth: 4,
    maxPaths: 8,
  });

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.mcp.solve-graph.alternative-paths-explanation.v0");
  assert.equal(first.status, "complete");
  assert.equal(first.headline, "Alternative paths found");
  assert.deepEqual(first.paths.map((path) => path.hopCount), [1, 2, 2]);
  assert.deepEqual(first.summary, {
    pathCount: 3,
    shortestHopCount: 1,
    longestHopCount: 2,
    statesCreated: first.summary.statesCreated,
  });
  assert.equal(first.paths[0]!.steps[0]!.sentence, "src/source.ts --imports--> src/target.ts");
  assert.ok(first.paths.every((path) => path.nodes.every((node) => !Object.hasOwn(node, "identity") && !Object.hasOwn(node, "evidence"))));
  assert.deepEqual(first.execution, {
    networkAccess: false,
    writeAccess: false,
    queryTruncated: false,
    maxDepth: 4,
    maxPaths: 8,
    maxStates: 2_000,
  });
});

test("dependent explanations preserve underlying edge orientation in sentences", () => {
  const result = explainSolveGraphAlternativePaths(fixture(), targetId, sourceId, {
    direction: "dependents",
    edgeKinds: ["calls", "imports"],
  });

  assert.equal(result.paths.length, 3);
  assert.equal(result.paths[0]!.steps[0]!.sentence, "src/target.ts <--imports-- src/source.ts");
  assert.deepEqual(result.paths[0]!.steps.map((step) => [step.from.id, step.to.id]), [[targetId, sourceId]]);
});

test("bounded searches report partial truth without claiming completeness", () => {
  const pathBound = explainSolveGraphAlternativePaths(fixture(), sourceId, targetId, {
    edgeKinds: ["calls", "imports"],
    maxPaths: 1,
  });
  assert.equal(pathBound.status, "partial");
  assert.equal(pathBound.summary.pathCount, 1);
  assert.match(pathBound.detail, /additional paths may exist/);
  assert.match(pathBound.notices[0] ?? "", /path-count bound/);

  const depthBound = explainSolveGraphAlternativePaths(fixture(), sourceId, targetId, {
    edgeKinds: ["calls", "imports"],
    maxDepth: 1,
    maxPaths: 8,
  });
  assert.equal(depthBound.status, "partial");
  assert.equal(depthBound.summary.pathCount, 1);
  assert.match(depthBound.notices[0] ?? "", /depth bound/);

  const stateBound = explainSolveGraphAlternativePaths(fixture(), sourceId, targetId, {
    edgeKinds: ["calls", "imports"],
    maxStates: 1,
  });
  assert.equal(stateBound.status, "partial");
  assert.equal(stateBound.summary.pathCount, 0);
  assert.match(stateBound.detail, /absence is not proven/);
  assert.match(stateBound.notices[0] ?? "", /traversal-state bound/);
});

test("complete no-path and zero-hop explanations remain explicit", () => {
  const noPath = explainSolveGraphAlternativePaths(fixture(), sourceId, isolatedId, {
    edgeKinds: ["calls", "imports"],
  });
  assert.equal(noPath.status, "complete");
  assert.equal(noPath.summary.pathCount, 0);
  assert.equal(noPath.headline, "No alternative path found");
  assert.match(noPath.detail, /No path exists/);

  const same = explainSolveGraphAlternativePaths(fixture(), sourceId, sourceId);
  assert.equal(same.status, "complete");
  assert.equal(same.summary.pathCount, 1);
  assert.equal(same.summary.shortestHopCount, 0);
  assert.equal(same.headline, "Source and target are the same node");
});

test("explanation validation rejects tampered response orientation and capabilities", () => {
  const orientation = findSolveGraphAlternativePaths(fixture(), sourceId, targetId, { maxPaths: 8 });
  orientation.paths[0]!.hops[0]!.traversalToId = firstId;
  assert.throws(() => createSolveGraphAlternativePathsExplanation(orientation), /mismatched traversal evidence/);

  const capability = findSolveGraphAlternativePaths(fixture(), sourceId, targetId, { maxPaths: 8 }) as unknown as {
    execution: { networkAccess: boolean; writeAccess: boolean; maxDepth: number; maxPaths: number; maxStates: number };
  };
  capability.execution.networkAccess = true;
  assert.throws(
    () => createSolveGraphAlternativePathsExplanation(capability as unknown as ReturnType<typeof findSolveGraphAlternativePaths>),
    /capability-free input/,
  );
});
