import assert from "node:assert/strict";
import test from "node:test";

import {
  createSolveGraphDocument,
  createSolveGraphNode,
} from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { searchSolveGraphNodesRanked } from "./ranked-search";

async function fixtureIndex() {
  const exactLabel = await createSolveGraphNode({
    kind: "route",
    identity: "route:GET:/api/customers",
    label: "customers",
    evidence: [{ kind: "configuration", path: "src/routes/customers.ts", line: 8 }],
    metadata: { framework: "nextjs" },
  });
  const identityMatch = await createSolveGraphNode({
    kind: "function",
    identity: "function:customers",
    label: "loadCustomers",
    evidence: [{ kind: "parser", path: "src/services/customer-service.ts", line: 3 }],
    metadata: { layer: "service" },
  });
  const evidenceMatch = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/customer-view.tsx",
    label: "Customer view",
    evidence: [{ kind: "parser", path: "src/customer-view.tsx", line: 1 }],
    metadata: { language: "typescript" },
  });
  const metadataMatch = await createSolveGraphNode({
    kind: "resource",
    identity: "resource:queue",
    label: "Primary queue",
    evidence: [{ kind: "configuration", path: "infra/queue.yml", line: 4 }],
    metadata: { provider: "customers" },
  });

  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "ranked-search-fixture", version: "1", deterministic: true }],
    nodes: [metadataMatch, evidenceMatch, identityMatch, exactLabel],
    edges: [],
  });
  return {
    index: await createSolveGraphQueryIndex(document),
    exactLabel,
    identityMatch,
    evidenceMatch,
    metadataMatch,
  };
}

test("ranks exact labels ahead of weaker identity, evidence, and metadata matches", async () => {
  const { index, exactLabel, identityMatch, evidenceMatch, metadataMatch } = await fixtureIndex();
  const result = searchSolveGraphNodesRanked(index, "customers");

  assert.equal(result.schema, "solvelang.solve-graph.ranked-node-search.v0");
  assert.equal(result.mode, "analyze-only");
  assert.equal(result.matches[0]?.node.id, exactLabel.id);
  assert.ok(result.matches.some((match) => match.node.id === identityMatch.id));
  assert.ok(result.matches.some((match) => match.node.id === evidenceMatch.id));
  assert.ok(result.matches.some((match) => match.node.id === metadataMatch.id));
  assert.ok(result.matches[0]!.score > result.matches[1]!.score);
  assert.ok(result.matches[0]!.reasons.includes("exact-label"));
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
});

test("matches exact evidence basenames and string metadata without exposing a new capability", async () => {
  const { index, evidenceMatch, metadataMatch } = await fixtureIndex();

  const byEvidence = searchSolveGraphNodesRanked(index, "customer-view.tsx");
  assert.equal(byEvidence.matches[0]?.node.id, evidenceMatch.id);
  assert.ok(byEvidence.matches[0]?.reasons.includes("evidence-path-basename"));

  const byMetadata = searchSolveGraphNodesRanked(index, "customers", { kinds: ["resource"] });
  assert.deepEqual(byMetadata.matches.map((match) => match.node.id), [metadataMatch.id]);
  assert.ok(byMetadata.matches[0]?.reasons.includes("metadata-exact"));
  assert.equal(byMetadata.execution.candidatesExamined, 1);
});

test("normalizes query text, applies deterministic bounds, and reports truncation", async () => {
  const { index } = await fixtureIndex();
  const first = searchSolveGraphNodesRanked(index, "  CUSTOMERS  ", { limit: 2 });
  const second = searchSolveGraphNodesRanked(index, "customers", { limit: 2 });

  assert.deepEqual(first, second);
  assert.equal(first.query, "customers");
  assert.equal(first.matches.length, 2);
  assert.equal(first.truncated, true);
});

test("fails closed on invalid ranked-search input", async () => {
  const { index } = await fixtureIndex();

  assert.throws(() => searchSolveGraphNodesRanked(index, "   "), /must not be empty/);
  assert.throws(() => searchSolveGraphNodesRanked(index, "x".repeat(513)), /must not exceed 512/);
  assert.throws(() => searchSolveGraphNodesRanked(index, "customers", { limit: 0 }), /limit must be an integer/);
  assert.throws(
    () => searchSolveGraphNodesRanked(index, "customers", { kinds: ["invalid" as never] }),
    /node kind is invalid/,
  );
});
