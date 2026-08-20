import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { findSolveGraphUnreachableCandidates } from "../src/solve-graph-unreachable-candidates.js";
import {
  canonicalSolveGraphJson,
  SOLVE_GRAPH_SCHEMA,
  type SolveGraphDocument,
  type SolveGraphEdge,
  type SolveGraphNode,
} from "../src/solve-graph.js";

function digest(value: unknown) {
  return createHash("sha256")
    .update(canonicalSolveGraphJson(value))
    .digest("hex");
}
function node(identity: string): SolveGraphNode {
  return {
    id: `sgn_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind: "file", identity }).slice(0, 32)}`,
    kind: "file",
    identity,
    label: identity,
    evidence: [{ path: identity }],
  };
}
function edge(from: string, to: string): SolveGraphEdge {
  return {
    id: `sge_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind: "imports", from, to, qualifier: "" }).slice(0, 32)}`,
    kind: "imports",
    from,
    to,
    evidence: [{ path: "fixture" }],
  };
}
function fixture() {
  const root = node("root");
  const reached = node("reached");
  const hidden = node("hidden");
  const document: SolveGraphDocument = {
    schema: SOLVE_GRAPH_SCHEMA,
    graphId: `sg_${"a".repeat(32)}`,
    mode: "analyze-only",
    engine: { name: "test", version: "1", deterministic: true },
    source: { fingerprint: `sha256:${"b".repeat(64)}` },
    extractors: [],
    limits: {},
    execution: { networkAccess: false, writeAccess: false },
    nodes: [root, reached, hidden],
    edges: [edge(root.id, reached.id)],
    integrity: {
      canonicalJsonSha256: `sha256:${"0".repeat(64)}`,
      stableIds: true,
      ordering: "id-ascending",
    },
  };
  return { document, root, hidden };
}
test("returns stable structural unreached candidates", () => {
  const { document, root, hidden } = fixture();
  const result = findSolveGraphUnreachableCandidates(document, [root.id], {
    maxCandidates: 1,
  });
  assert.deepEqual(
    result.candidates.map((item) => item.id),
    [hidden.id],
  );
  assert.equal(result.summary.matchedCandidates, 1);
  assert.match(result.notices[0] ?? "", /static structural/);
});
test("keeps traversal caps and unsafe input explicit", () => {
  const { document, root } = fixture();
  assert.equal(
    findSolveGraphUnreachableCandidates(document, [root.id], { maxDepth: 0 })
      .truncated,
    true,
  );
  assert.throws(
    () =>
      findSolveGraphUnreachableCandidates(document, [root.id], {
        maxCandidates: 101,
      }),
    /maxCandidates/,
  );
  assert.throws(
    () =>
      findSolveGraphUnreachableCandidates(
        {
          ...document,
          execution: { ...document.execution, networkAccess: true },
        } as unknown as SolveGraphDocument,
        [root.id],
      ),
    /capability-free/,
  );
});
