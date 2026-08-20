import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { findSolveGraphHotspots } from "../src/solve-graph-hotspots.js";
import { canonicalSolveGraphJson, SOLVE_GRAPH_SCHEMA, type SolveGraphDocument, type SolveGraphEdge, type SolveGraphNode } from "../src/solve-graph.js";

function digest(value: unknown): string { return createHash("sha256").update(canonicalSolveGraphJson(value), "utf8").digest("hex"); }
function node(identity: string, label: string): SolveGraphNode {
  return { id: `sgn_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind: "file", identity }).slice(0, 32)}`, kind: "file", identity, label, evidence: [{ path: label }], metadata: { path: label } };
}
function edge(from: string, to: string): SolveGraphEdge {
  return { id: `sge_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind: "imports", from, to, qualifier: "" }).slice(0, 32)}`, kind: "imports", from, to, evidence: [{ path: "fixture" }] };
}
function fixture(): SolveGraphDocument {
  const a = node("file:a", "a.ts"); const b = node("file:b", "b.ts"); const c = node("file:c", "c.ts"); const d = node("file:d", "d.ts");
  return { schema: SOLVE_GRAPH_SCHEMA, graphId: `sg_${"a".repeat(32)}`, mode: "analyze-only", engine: { name: "test", version: "test", deterministic: true }, source: { fingerprint: `sha256:${"b".repeat(64)}` }, extractors: [], limits: {}, execution: { networkAccess: false, writeAccess: false }, nodes: [a, b, c, d], edges: [edge(a.id, b.id), edge(c.id, b.id), edge(d.id, c.id)], integrity: { canonicalJsonSha256: `sha256:${"0".repeat(64)}`, stableIds: true, ordering: "id-ascending" } };
}

test("returns deterministic impact-ranked hotspot candidates with safe summaries", () => {
  const first = findSolveGraphHotspots(fixture());
  const second = findSolveGraphHotspots(fixture());
  assert.deepEqual(first, second);
  assert.equal(first.tool, "solve_graph.hotspots");
  assert.equal(first.hotspots[0]?.node.label, "b.ts");
  assert.equal(first.hotspots[0]?.directDependents, 2);
  assert.equal(first.hotspots[0]?.transitiveDependents, 3);
  assert.deepEqual(Object.keys(first.hotspots[0]!.node).sort(), ["id", "kind", "label", "path"]);
  assert.match(first.notices[0] ?? "", /candidate evidence/);
  assert.deepEqual(first.execution, { networkAccess: false, writeAccess: false, edgeKinds: ["calls", "depends-on", "deploys", "exposes", "grants", "imports", "reads", "references", "tests", "triggers", "writes"], maxHotspots: 30, maxImpactDepth: 4, maxImpactResults: 500 });
});

test("keeps candidate and impact truncation truth explicit", () => {
  const candidatesBounded = findSolveGraphHotspots(fixture(), { maxHotspots: 1 });
  assert.equal(candidatesBounded.truncated, true);
  assert.equal(candidatesBounded.summary.hiddenCandidates, 1);
  const impactBounded = findSolveGraphHotspots(fixture(), { maxImpactDepth: 1 });
  assert.equal(impactBounded.hotspots[0]?.impactTruncated, true);
  assert.match(impactBounded.notices.at(-1) ?? "", /partial/);
});

test("rejects unsafe documents and invalid bounds", () => {
  const unsafe = fixture() as unknown as { execution: { networkAccess: boolean; writeAccess: boolean } };
  unsafe.execution.networkAccess = true;
  assert.throws(() => findSolveGraphHotspots(unsafe as unknown as SolveGraphDocument), /capability-free/);
  assert.throws(() => findSolveGraphHotspots(fixture(), { maxHotspots: 101 }), /maxHotspots/);
  assert.throws(() => findSolveGraphHotspots(fixture(), { maxImpactDepth: 65 }), /maxImpactDepth/);
  assert.throws(() => findSolveGraphHotspots(fixture(), { edgeKinds: ["invalid" as never] }), /edge kind/);
});
