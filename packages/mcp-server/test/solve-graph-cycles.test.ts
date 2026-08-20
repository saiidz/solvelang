import assert from "node:assert/strict";
import test from "node:test";
import { findSolveGraphCycles } from "../src/solve-graph-cycles.js";
import { SOLVE_GRAPH_SCHEMA, type SolveGraphDocument } from "../src/solve-graph.js";

const ids = {
  a: `sgn_${"a".repeat(32)}`,
  b: `sgn_${"b".repeat(32)}`,
  c: `sgn_${"c".repeat(32)}`,
  d: `sgn_${"d".repeat(32)}`,
  e: `sgn_${"e".repeat(32)}`,
};

function fixture(): SolveGraphDocument {
  return {
    schema: SOLVE_GRAPH_SCHEMA,
    graphId: `sg_${"f".repeat(32)}`,
    mode: "analyze-only",
    engine: { name: "SolveLang Solve Graph", version: "0.2.0", deterministic: true },
    source: { fingerprint: `sha256:${"1".repeat(64)}` },
    extractors: [],
    limits: {},
    execution: { networkAccess: false, writeAccess: false },
    nodes: Object.entries(ids).map(([label, id]) => ({ id, kind: "file", identity: `file:${label}.ts`, label: `${label}.ts`, evidence: [{ path: `${label}.ts` }], metadata: { path: `${label}.ts` } })),
    edges: [
      { id: `sge_${"1".repeat(32)}`, kind: "imports", from: ids.a, to: ids.b, evidence: [{ path: "a.ts" }] },
      { id: `sge_${"2".repeat(32)}`, kind: "imports", from: ids.b, to: ids.a, evidence: [{ path: "b.ts" }] },
      { id: `sge_${"3".repeat(32)}`, kind: "calls", from: ids.c, to: ids.c, evidence: [{ path: "c.ts" }] },
      { id: `sge_${"4".repeat(32)}`, kind: "imports", from: ids.d, to: ids.e, evidence: [{ path: "d.ts" }] },
    ],
    integrity: { canonicalJsonSha256: `sha256:${"0".repeat(64)}`, stableIds: true, ordering: "id-ascending" },
  };
}

test("finds deterministic SCC cycles with a representative directed cycle", () => {
  const first = findSolveGraphCycles(fixture());
  const second = findSolveGraphCycles(fixture());

  assert.deepEqual(first, second);
  assert.equal(first.tool, "solve_graph.cycles");
  assert.equal(first.summary.cycleComponents, 2);
  assert.equal(first.truncated, false);
  assert.deepEqual(first.cycles.map((cycle) => cycle.nodes.map((node) => node.id)), [[ids.a, ids.b], [ids.c]]);
  assert.deepEqual(first.cycles[0]!.representativeCycle.map((node) => node.id), [ids.a, ids.b, ids.a]);
  assert.deepEqual(first.cycles[1]!.representativeCycle.map((node) => node.id), [ids.c, ids.c]);
  assert.match(first.notices[0] ?? "", /not automatically defects/);
  assert.deepEqual(first.execution, { networkAccess: false, writeAccess: false, maxComponents: 25, maxNodesPerComponent: 25 });
});

test("keeps edge selection and output truncation truth explicit", () => {
  const callsOnly = findSolveGraphCycles(fixture(), { edgeKinds: ["calls"] });
  assert.deepEqual(callsOnly.cycles.map((cycle) => cycle.nodes.map((node) => node.id)), [[ids.c]]);

  const componentsBounded = findSolveGraphCycles(fixture(), { maxComponents: 1 });
  assert.equal(componentsBounded.truncated, true);
  assert.deepEqual(componentsBounded.truncationReasons, ["component-count"]);
  assert.equal(componentsBounded.summary.hiddenComponents, 1);

  const nodesBounded = findSolveGraphCycles(fixture(), { maxNodesPerComponent: 1 });
  assert.equal(nodesBounded.truncated, true);
  assert.deepEqual(nodesBounded.truncationReasons, ["component-node-count"]);
  assert.equal(nodesBounded.cycles[0]!.truncated, true);
  assert.deepEqual(nodesBounded.cycles[0]!.representativeCycle.map((node) => node.id), [ids.a, ids.b, ids.a]);
});

test("rejects unsafe documents and invalid bounds", () => {
  const unsafe = fixture() as unknown as { execution: { networkAccess: boolean; writeAccess: boolean } };
  unsafe.execution.networkAccess = true;
  assert.throws(() => findSolveGraphCycles(unsafe as unknown as SolveGraphDocument), /analyze-only document/);
  assert.throws(() => findSolveGraphCycles(fixture(), { edgeKinds: ["invalid" as never] }), /edge kind/);
  assert.throws(() => findSolveGraphCycles(fixture(), { maxComponents: 101 }), /maxComponents/);
  assert.throws(() => findSolveGraphCycles(fixture(), { maxNodesPerComponent: 0 }), /maxNodesPerComponent/);
});
