import assert from "node:assert/strict";
import test from "node:test";

import { sha256Hex } from "../../repository-audit/core/ingestion";
import { canonicalSolveGraphJson, createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { findSolveGraphShortestPath } from "./shortest-path";
import {
  createSolveGraphShortestPathArtifact,
  createSolveGraphShortestPathDownload,
  serializeSolveGraphShortestPathArtifact,
} from "./shortest-path-artifact";

async function fixture() {
  const source = await createSolveGraphNode({ kind: "file", identity: "file:src/a.ts", label: "a.ts", evidence: [{ kind: "parser", path: "src/a.ts" }] });
  const middle = await createSolveGraphNode({ kind: "file", identity: "file:src/b.ts", label: "b.ts", evidence: [{ kind: "parser", path: "src/b.ts" }] });
  const target = await createSolveGraphNode({ kind: "file", identity: "file:src/c.ts", label: "c.ts", evidence: [{ kind: "parser", path: "src/c.ts" }] });
  const direct = await createSolveGraphEdge({ kind: "imports", from: source.id, to: target.id, evidence: [{ kind: "parser", path: "src/a.ts" }] });
  const first = await createSolveGraphEdge({ kind: "imports", from: source.id, to: middle.id, evidence: [{ kind: "parser", path: "src/a.ts" }] });
  const second = await createSolveGraphEdge({ kind: "calls", from: middle.id, to: target.id, evidence: [{ kind: "parser", path: "src/b.ts" }] });
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "shortest-path-artifact-fixture", version: "1", deterministic: true }],
    nodes: [target, source, middle],
    edges: [second, direct, first],
  });
  return { index: await createSolveGraphQueryIndex(document), source, target };
}

async function verifiesIntegrity(artifact: Awaited<ReturnType<typeof createSolveGraphShortestPathArtifact>>) {
  const { integrity, ...withoutIntegrity } = artifact;
  const digest = await sha256Hex(new TextEncoder().encode(canonicalSolveGraphJson(withoutIntegrity)));
  return digest === integrity.canonicalJsonSha256;
}

test("creates a deterministic graph-bound shortest-path artifact", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphShortestPath(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const first = await createSolveGraphShortestPathArtifact(index, result);
  const second = await createSolveGraphShortestPathArtifact(index, structuredClone(result));

  assert.deepEqual(first, second);
  assert.equal(first.graphId, index.document.graphId);
  assert.equal(first.found, true);
  assert.equal(first.nodeIds.length, 2);
  assert.equal(first.hops.length, 1);
  assert.equal(first.truncated, false);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.equal(await verifiesIntegrity(first), true);
  assert.ok(serializeSolveGraphShortestPathArtifact(first).endsWith("\n"));
});

test("preserves zero-hop and bounded no-path truth", async () => {
  const { index, source, target } = await fixture();
  const zeroHop = findSolveGraphShortestPath(index, source.id, source.id);
  const zeroArtifact = await createSolveGraphShortestPathArtifact(index, zeroHop);
  assert.equal(zeroArtifact.found, true);
  assert.deepEqual(zeroArtifact.nodeIds, [source.id]);
  assert.deepEqual(zeroArtifact.hops, []);
  assert.equal(zeroArtifact.visitedCount, 1);

  const depthBounded = findSolveGraphShortestPath(index, source.id, target.id, { maxDepth: 0 });
  const depthArtifact = await createSolveGraphShortestPathArtifact(index, depthBounded);
  assert.equal(depthArtifact.found, false);
  assert.equal(depthArtifact.truncated, true);
  assert.equal(depthArtifact.truncationReason, "depth");
  assert.deepEqual(depthArtifact.nodeIds, []);

  const visitedBounded = findSolveGraphShortestPath(index, source.id, target.id, { maxVisited: 1 });
  const visitedArtifact = await createSolveGraphShortestPathArtifact(index, visitedBounded);
  assert.equal(visitedArtifact.found, false);
  assert.equal(visitedArtifact.truncationReason, "visited-count");
});

test("artifact output is detached and browser download naming is bounded", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphShortestPath(index, source.id, target.id);
  const download = await createSolveGraphShortestPathDownload("My Repo.zip", index, result);
  const originalNode = download.artifact.nodeIds[0]!;
  result.nodeIds[0] = "sgn_mutated";

  assert.equal(download.artifact.nodeIds[0], originalNode);
  assert.equal(download.filename, "My-Repo-solvelang-shortest-path.json");
  assert.equal(download.mediaType, "application/json;charset=utf-8");
  assert.deepEqual(JSON.parse(download.content), download.artifact);
  assert.equal(await verifiesIntegrity(download.artifact), true);
});

test("fails closed for malformed path, edge, visited-count, and truncation contracts", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphShortestPath(index, source.id, target.id);

  const badEdge = structuredClone(result);
  badEdge.hops[0]!.edgeId = "sge_missing";
  await assert.rejects(createSolveGraphShortestPathArtifact(index, badEdge), /missing or mismatched edge/);

  const badVisited = structuredClone(result);
  badVisited.visitedCount = 0;
  await assert.rejects(createSolveGraphShortestPathArtifact(index, badVisited), /visitedCount is invalid/);

  const foundAndTruncated = { ...structuredClone(result), truncated: true, truncationReason: "depth" as const };
  await assert.rejects(createSolveGraphShortestPathArtifact(index, foundAndTruncated), /cannot mark a found path as truncated/);

  const missingPath = { ...structuredClone(result), found: false };
  await assert.rejects(createSolveGraphShortestPathArtifact(index, missingPath), /must not contain a path/);
});
