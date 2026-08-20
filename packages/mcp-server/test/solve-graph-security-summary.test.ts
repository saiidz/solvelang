import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { summarizeSolveGraphSecurity } from "../src/solve-graph-security-summary.js";
import { canonicalSolveGraphJson, SOLVE_GRAPH_SCHEMA, type SolveGraphDocument, type SolveGraphEdge, type SolveGraphNode } from "../src/solve-graph.js";

function digest(value: unknown): string { return createHash("sha256").update(canonicalSolveGraphJson(value), "utf8").digest("hex"); }
function node(kind: SolveGraphNode["kind"], identity: string, label: string): SolveGraphNode { return { id: `sgn_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind, identity }).slice(0, 32)}`, kind, identity, label, evidence: [{ path: label }], metadata: { path: label } }; }
function edge(kind: SolveGraphEdge["kind"], from: string, to: string): SolveGraphEdge { return { id: `sge_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind, from, to, qualifier: "" }).slice(0, 32)}`, kind, from, to, evidence: [{ path: "fixture" }] }; }
function fixture() {
  const route = node("route", "route:/api", "/api"); const permission = node("permission", "perm:reader", "reader"); const resource = node("resource", "resource:bucket", "bucket"); const file = node("file", "file:app", "app.ts");
  const document: SolveGraphDocument = { schema: SOLVE_GRAPH_SCHEMA, graphId: `sg_${"a".repeat(32)}`, mode: "analyze-only", engine: { name: "test", version: "test", deterministic: true }, source: { fingerprint: `sha256:${"b".repeat(64)}` }, extractors: [], limits: {}, execution: { networkAccess: false, writeAccess: false }, nodes: [route, permission, resource, file], edges: [edge("exposes", route.id, file.id), edge("grants", permission.id, resource.id), edge("imports", file.id, resource.id)], integrity: { canonicalJsonSha256: `sha256:${"0".repeat(64)}`, stableIds: true, ordering: "id-ascending" } };
  return { document, route, permission, resource };
}

test("returns deterministic bounded structural security candidates without audit claims", () => {
  const { document, route, permission, resource } = fixture();
  const first = summarizeSolveGraphSecurity(document); const second = summarizeSolveGraphSecurity(document);
  assert.deepEqual(first, second); assert.equal(first.tool, "solve_graph.security_summary");
  assert.deepEqual(first.nodes.map((entry) => entry.id), [route.id, permission.id, resource.id].sort());
  assert.equal(first.summary.securityRelevantNodeCandidates, 3); assert.equal(first.summary.securityRelevantRelationshipCandidates, 2);
  assert.match(first.notices[0] ?? "", /not a security audit/);
  assert.deepEqual(first.execution, { networkAccess: false, writeAccess: false, maxNodes: 100, maxRelationships: 100 });
});

test("keeps node and relationship output bounds explicit", () => {
  const { document } = fixture(); const bounded = summarizeSolveGraphSecurity(document, { maxNodes: 1, maxRelationships: 1 });
  assert.equal(bounded.nodes.length, 1); assert.equal(bounded.relationships.length, 1); assert.equal(bounded.truncated, true); assert.match(bounded.notices.at(-1) ?? "", /omitted/);
});
