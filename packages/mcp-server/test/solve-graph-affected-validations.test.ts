import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { findSolveGraphAffectedValidations } from "../src/solve-graph-affected-validations.js";
import { canonicalSolveGraphJson, SOLVE_GRAPH_SCHEMA, type SolveGraphDocument, type SolveGraphEdge, type SolveGraphNode } from "../src/solve-graph.js";

function digest(value: unknown): string { return createHash("sha256").update(canonicalSolveGraphJson(value), "utf8").digest("hex"); }
function node(kind: SolveGraphNode["kind"], identity: string, label: string): SolveGraphNode {
  return { id: `sgn_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind, identity }).slice(0, 32)}`, kind, identity, label, evidence: [{ path: label }], metadata: { path: label } };
}
function edge(kind: SolveGraphEdge["kind"], from: string, to: string): SolveGraphEdge {
  return { id: `sge_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind, from, to, qualifier: "" }).slice(0, 32)}`, kind, from, to, evidence: [{ path: "fixture" }] };
}
function fixture(): { document: SolveGraphDocument; changed: SolveGraphNode; directTest: SolveGraphNode; workflow: SolveGraphNode; indirectTest: SolveGraphNode } {
  const changed = node("file", "file:src/core.ts", "src/core.ts");
  const helper = node("module", "module:src/helper", "src/helper");
  const directTest = node("test", "test:core", "test/core.test.ts");
  const workflow = node("workflow", "workflow:ci", "CI");
  const indirectTest = node("test", "test:integration", "test/integration.test.ts");
  const unrelated = node("file", "file:README", "README.md");
  const document: SolveGraphDocument = {
    schema: SOLVE_GRAPH_SCHEMA,
    graphId: `sg_${"a".repeat(32)}`,
    mode: "analyze-only",
    engine: { name: "test", version: "test", deterministic: true },
    source: { fingerprint: `sha256:${"b".repeat(64)}` },
    extractors: [], limits: {}, execution: { networkAccess: false, writeAccess: false },
    nodes: [changed, helper, directTest, workflow, indirectTest, unrelated],
    edges: [
      edge("tests", directTest.id, changed.id),
      edge("triggers", workflow.id, changed.id),
      edge("imports", helper.id, changed.id),
      edge("tests", indirectTest.id, helper.id),
    ],
    integrity: { canonicalJsonSha256: `sha256:${"0".repeat(64)}`, stableIds: true, ordering: "id-ascending" },
  };
  return { document, changed, directTest, workflow, indirectTest };
}

test("returns deterministic structural validation candidates with dependency evidence", () => {
  const { document, changed, directTest, workflow, indirectTest } = fixture();
  const first = findSolveGraphAffectedValidations(document, [changed.id]);
  const second = findSolveGraphAffectedValidations(document, [changed.id]);
  assert.deepEqual(first, second);
  assert.equal(first.tool, "solve_graph.affected_validations");
  assert.deepEqual(first.validations.map((entry) => entry.id), [workflow.id, directTest.id, indirectTest.id]);
  assert.deepEqual(first.validations.map((entry) => entry.depth), [1, 1, 2]);
  assert.equal(first.validations[0]?.viaEdgeKind, "triggers");
  assert.equal(first.validations[1]?.viaEdgeKind, "tests");
  assert.equal(first.validations[2]?.parentId, document.nodes.find((entry) => entry.kind === "module")?.id);
  assert.equal(first.summary.matchedValidationCandidates, 3);
  assert.equal(first.truncated, false);
  assert.match(first.notices[0] ?? "", /candidate evidence/);
  assert.deepEqual(first.execution, { networkAccess: false, writeAccess: false, edgeKinds: ["calls", "depends-on", "deploys", "exposes", "grants", "imports", "reads", "references", "tests", "triggers", "writes"], maxDepth: 4, maxResults: 1_000, maxValidations: 100 });
});

test("keeps query and presentation bounds distinct", () => {
  const { document, changed } = fixture();
  const presentationBounded = findSolveGraphAffectedValidations(document, [changed.id], { maxValidations: 1 });
  assert.equal(presentationBounded.truncated, true);
  assert.equal(presentationBounded.queryTruncated, false);
  assert.equal(presentationBounded.presentationTruncated, true);
  assert.equal(presentationBounded.summary.hiddenValidationCandidates, 2);
  assert.match(presentationBounded.notices.at(-1) ?? "", /output bound/);

  const queryBounded = findSolveGraphAffectedValidations(document, [changed.id], { maxDepth: 1 });
  assert.equal(queryBounded.truncated, true);
  assert.equal(queryBounded.queryTruncated, true);
  assert.equal(queryBounded.presentationTruncated, false);
  assert.match(queryBounded.notices.at(-1) ?? "", /depth bound/);
});

test("rejects unsafe documents and invalid bounds", () => {
  const { document, changed } = fixture();
  const unsafe = document as unknown as { execution: { networkAccess: boolean; writeAccess: boolean } };
  unsafe.execution.networkAccess = true;
  assert.throws(() => findSolveGraphAffectedValidations(unsafe as unknown as SolveGraphDocument, [changed.id]), /capability-free/);
  const fresh = fixture();
  assert.throws(() => findSolveGraphAffectedValidations(fresh.document, [fresh.changed.id], { maxValidations: 101 }), /maxValidations/);
  assert.throws(() => findSolveGraphAffectedValidations(fresh.document, [fresh.changed.id], { maxDepth: 65 }), /maxDepth/);
  assert.throws(() => findSolveGraphAffectedValidations(fresh.document, ["sgn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]), /does not exist/);
});
