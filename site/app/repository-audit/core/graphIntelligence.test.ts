import assert from "node:assert/strict";
import test from "node:test";
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "../../solve-graph/core/canonical";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import { createRepositoryGraphIntelligence } from "./graphIntelligence";

async function fixture() {
  const repository = await createSolveGraphNode({
    kind: "repository",
    identity: "repo:audit-graph",
    label: "Audit graph",
    evidence: [{ kind: "deterministic-analysis", path: "README.md" }],
  });
  const store = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/store.ts",
    label: "src/store.ts",
    evidence: [{ kind: "parser", path: "src/store.ts" }],
    metadata: { path: "src/store.ts" },
  });
  const api = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/api.ts",
    label: "src/api.ts",
    evidence: [{ kind: "parser", path: "src/api.ts" }],
    metadata: { path: "src/api.ts" },
  });
  const worker = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/worker.ts",
    label: "src/worker.ts",
    evidence: [{ kind: "parser", path: "src/worker.ts" }],
    metadata: { path: "src/worker.ts" },
  });
  const apiTest = await createSolveGraphNode({
    kind: "test",
    identity: "test:test/api.test.ts",
    label: "test/api.test.ts",
    evidence: [{ kind: "parser", path: "test/api.test.ts" }],
  });

  const edges = await Promise.all([
    createSolveGraphEdge({ kind: "contains", from: repository.id, to: store.id, evidence: [{ kind: "deterministic-analysis", path: "src/store.ts" }] }),
    createSolveGraphEdge({ kind: "contains", from: repository.id, to: api.id, evidence: [{ kind: "deterministic-analysis", path: "src/api.ts" }] }),
    createSolveGraphEdge({ kind: "contains", from: repository.id, to: worker.id, evidence: [{ kind: "deterministic-analysis", path: "src/worker.ts" }] }),
    createSolveGraphEdge({ kind: "imports", from: api.id, to: store.id, evidence: [{ kind: "parser", path: "src/api.ts" }] }),
    createSolveGraphEdge({ kind: "imports", from: worker.id, to: store.id, evidence: [{ kind: "parser", path: "src/worker.ts" }] }),
    createSolveGraphEdge({ kind: "tests", from: apiTest.id, to: api.id, evidence: [{ kind: "parser", path: "test/api.test.ts" }] }),
  ]);

  return createSolveGraphDocument({
    source: { ...solveGraphFixtureSource, displayName: "audit-graph" },
    extractors: [{ id: "fixture", version: "1", deterministic: true }],
    nodes: [repository, store, api, worker, apiTest],
    edges,
  });
}

test("reuses Solve Graph to produce deterministic counts and impact-ranked hotspots", async () => {
  const document = await fixture();
  const intelligence = await createRepositoryGraphIntelligence(document);
  assert.equal(intelligence.graphId, document.graphId);
  assert.deepEqual(intelligence.counts.nodesByKind, [
    { kind: "repository", count: 1 },
    { kind: "file", count: 3 },
    { kind: "test", count: 1 },
  ]);
  assert.deepEqual(intelligence.counts.edgesByKind, [
    { kind: "contains", count: 3 },
    { kind: "imports", count: 2 },
    { kind: "tests", count: 1 },
  ]);
  assert.equal(intelligence.hotspots[0].label, "src/store.ts");
  assert.equal(intelligence.hotspots[0].directDependents, 2);
  assert.equal(intelligence.hotspots[0].transitiveImpact, 3);
  assert.equal(intelligence.hotspots[0].path, "src/store.ts");
  assert.equal(intelligence.execution.networkAccess, false);
  assert.equal(intelligence.execution.writeAccess, false);
});

test("containment edges do not inflate dependency hotspot scoring", async () => {
  const intelligence = await createRepositoryGraphIntelligence(await fixture());
  assert.ok(intelligence.hotspots.every((item) => item.kind !== "repository"));
  assert.equal(intelligence.hotspots.find((item) => item.label === "src/store.ts")?.directDependents, 2);
});

test("hotspot and impact bounds are explicit and deterministic", async () => {
  const document = await fixture();
  const intelligence = await createRepositoryGraphIntelligence(document, {
    maxHotspots: 1,
    maxImpactDepth: 1,
    maxImpactResults: 2,
  });
  assert.equal(intelligence.hotspots.length, 1);
  assert.equal(intelligence.execution.hotspotCandidatesTruncated, true);
  assert.equal(intelligence.hotspots[0].impactTruncated, true);
  await assert.rejects(
    createRepositoryGraphIntelligence(document, { maxHotspots: 101 }),
    /maxHotspots/,
  );
});

test("integrity-invalid graph input fails closed before intelligence is produced", async () => {
  const document = await fixture();
  const tampered = structuredClone(document);
  tampered.nodes[0].label = "tampered";
  await assert.rejects(createRepositoryGraphIntelligence(tampered), /integrity-valid/);
});
