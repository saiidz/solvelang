import assert from "node:assert/strict";
import test from "node:test";

import { searchSolveGraphNodesRanked } from "../src/solve-graph-ranked-search.js";
import type { SolveGraphDocument } from "../src/solve-graph.js";

function graphFixture(): SolveGraphDocument {
  return {
    schema: "solvelang.graph.v0",
    graphId: `sg_${"a".repeat(32)}`,
    mode: "analyze-only",
    engine: { name: "SolveLang Solve Graph", version: "test", deterministic: true },
    source: { fingerprint: `sha256:${"b".repeat(64)}` },
    extractors: [],
    limits: {},
    execution: { networkAccess: false, writeAccess: false },
    nodes: [
      {
        id: `sgn_${"1".repeat(32)}`,
        kind: "route",
        identity: "route:GET:/customers",
        label: "customers",
        evidence: [{ path: "src/routes/customers.ts" }],
      },
      {
        id: `sgn_${"2".repeat(32)}`,
        kind: "function",
        identity: "function:customers",
        label: "loadCustomers",
        evidence: [{ path: "src/services/customer-service.ts" }],
      },
      {
        id: `sgn_${"3".repeat(32)}`,
        kind: "file",
        identity: "file:customer-view",
        label: "Customer view",
        evidence: [{ path: "src/customers/customer-view.tsx" }],
        metadata: { path: "src/customers/customer-view.tsx", language: "typescript" },
      },
      {
        id: `sgn_${"4".repeat(32)}`,
        kind: "resource",
        identity: "resource:queue",
        label: "Primary queue",
        evidence: [{ path: "infra/queue.yml" }],
        metadata: { provider: "customers" },
      },
    ],
    edges: [],
    integrity: { canonicalJsonSha256: `sha256:${"c".repeat(64)}`, stableIds: true, ordering: "id-ascending" },
  };
}

test("ranked MCP search favors strong semantic matches and returns safe summaries", () => {
  const result = searchSolveGraphNodesRanked(graphFixture(), "customers");

  assert.equal(result.tool, "solve_graph.search_nodes");
  assert.equal(result.matches[0]?.node.kind, "route");
  assert.ok(result.matches[0]?.reasons.includes("exact-label"));
  assert.equal(result.matches.some((match) => match.node.id === `sgn_${"3".repeat(32)}`), true);
  assert.equal(result.matches.some((match) => match.node.id === `sgn_${"4".repeat(32)}`), true);
  assert.deepEqual(Object.keys(result.matches[0]!.node).sort(), ["id", "kind", "label"]);
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
});

test("ranked MCP search supports kind filters, basename evidence, and bounded truncation", () => {
  const byEvidence = searchSolveGraphNodesRanked(graphFixture(), "customer-view.tsx");
  assert.equal(byEvidence.matches[0]?.node.path, "src/customers/customer-view.tsx");
  assert.ok(byEvidence.matches[0]?.reasons.includes("evidence-path-basename"));

  const bounded = searchSolveGraphNodesRanked(graphFixture(), "customers", { kinds: ["route", "function"], limit: 1 });
  assert.equal(bounded.matches.length, 1);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.execution.candidatesExamined, 2);
});

test("ranked MCP search rejects invalid query, kinds, limits, and mutable-capability documents", () => {
  assert.throws(() => searchSolveGraphNodesRanked(graphFixture(), "   "), /must not be empty/);
  assert.throws(() => searchSolveGraphNodesRanked(graphFixture(), "x", { limit: 0 }), /limit must be an integer/);
  assert.throws(() => searchSolveGraphNodesRanked(graphFixture(), "x", { kinds: ["bad" as never] }), /node kind is invalid/);
  const mutable = graphFixture();
  mutable.execution = { ...mutable.execution, networkAccess: true as never };
  assert.throws(() => searchSolveGraphNodesRanked(mutable, "x"), /networkAccess=false/);
});
