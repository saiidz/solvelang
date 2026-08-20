import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { findSolveGraphEntrypointCandidates } from "../src/solve-graph-entrypoints.js";
import { canonicalSolveGraphJson, SOLVE_GRAPH_SCHEMA, type SolveGraphDocument, type SolveGraphNode } from "../src/solve-graph.js";
function hash(value: unknown) { return createHash("sha256").update(canonicalSolveGraphJson(value)).digest("hex"); }
function node(kind: SolveGraphNode["kind"], identity: string): SolveGraphNode { return { id: `sgn_${hash({ schema: SOLVE_GRAPH_SCHEMA, kind, identity }).slice(0, 32)}`, kind, identity, label: identity, evidence: [{ path: identity }] }; }
test("returns deterministic bounded route workflow job and exposes candidates", () => {
  const route = node("route", "route"); const workflow = node("workflow", "workflow"); const file = node("file", "file"); const document: SolveGraphDocument = { schema: SOLVE_GRAPH_SCHEMA, graphId: `sg_${"a".repeat(32)}`, mode: "analyze-only", engine: { name: "test", version: "1", deterministic: true }, source: { fingerprint: `sha256:${"b".repeat(64)}` }, extractors: [], limits: {}, execution: { networkAccess: false, writeAccess: false }, nodes: [route, workflow, file], edges: [{ id: `sge_${hash({ schema: SOLVE_GRAPH_SCHEMA, kind: "exposes", from: file.id, to: route.id, qualifier: "" }).slice(0, 32)}`, kind: "exposes", from: file.id, to: route.id, evidence: [{ path: "fixture" }] }], integrity: { canonicalJsonSha256: `sha256:${"0".repeat(64)}`, stableIds: true, ordering: "id-ascending" } };
  const result = findSolveGraphEntrypointCandidates(document, { maxCandidates: 2 });
  assert.equal(result.tool, "solve_graph.entrypoint_candidates"); assert.equal(result.summary.matchedCandidates, 3); assert.equal(result.candidates.length, 2); assert.equal(result.truncated, true); assert.match(result.notices[0] ?? "", /static structural/);
  assert.throws(() => findSolveGraphEntrypointCandidates(document, { maxCandidates: 101 }), /maxCandidates/);
});
