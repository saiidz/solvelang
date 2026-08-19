import assert from "node:assert/strict";
import test from "node:test";
import { sha256Hex } from "../../repository-audit/core/ingestion";
import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode, canonicalSolveGraphJson } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { findSolveGraphAlternativePaths } from "./alternative-paths";
import {
  createSolveGraphAlternativePathsArtifact,
  createSolveGraphAlternativePathsDownload,
  serializeSolveGraphAlternativePathsArtifact,
} from "./alternative-paths-artifact";

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
    extractors: [{ id: "alternative-artifact-fixture", version: "1", deterministic: true }],
    nodes: [target, source, middle],
    edges: [second, direct, first],
  });
  const index = await createSolveGraphQueryIndex(document);
  const result = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  return { index, result, source, target };
}

async function verifyArtifactIntegrity(artifact: Awaited<ReturnType<typeof createSolveGraphAlternativePathsArtifact>>) {
  const { integrity, ...withoutIntegrity } = artifact;
  const digest = await sha256Hex(new TextEncoder().encode(canonicalSolveGraphJson(withoutIntegrity)));
  return digest === integrity.canonicalJsonSha256;
}

test("creates deterministic graph-bound alternative-path artifacts", async () => {
  const { index, result } = await fixture();
  const first = await createSolveGraphAlternativePathsArtifact(index, result);
  const second = await createSolveGraphAlternativePathsArtifact(index, result);

  assert.deepEqual(first, second);
  assert.equal(first.graphId, index.document.graphId);
  assert.equal(first.paths.length, 2);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.equal(await verifyArtifactIntegrity(first), true);
  assert.ok(serializeSolveGraphAlternativePathsArtifact(first).endsWith("\n"));
});

test("artifact is detached and tampering changes the integrity digest", async () => {
  const { index, result } = await fixture();
  const artifact = await createSolveGraphAlternativePathsArtifact(index, result);
  result.paths[0]!.nodeIds[0] = "changed-after-export";
  result.paths[0]!.hops[0]!.from = "changed-after-export";

  assert.notEqual(artifact.paths[0]!.nodeIds[0], "changed-after-export");
  assert.notEqual(artifact.paths[0]!.hops[0]!.from, "changed-after-export");

  const tampered = { ...artifact, statesCreated: artifact.statesCreated + 1 };
  assert.equal(await verifyArtifactIntegrity(tampered), false);
});

test("fails closed for malformed path, edge, direction, and truncation contracts", async () => {
  const { index, result } = await fixture();
  const malformedPath = structuredClone(result);
  malformedPath.paths[0]!.nodeIds.push(malformedPath.sourceId);
  await assert.rejects(createSolveGraphAlternativePathsArtifact(index, malformedPath), /path shape|simple/);

  const malformedEdge = structuredClone(result);
  malformedEdge.paths[0]!.hops[0]!.edgeId = "sge_missing";
  await assert.rejects(createSolveGraphAlternativePathsArtifact(index, malformedEdge), /missing or mismatched edge/);

  const malformedDirection = { ...structuredClone(result), direction: "sideways" as never };
  await assert.rejects(createSolveGraphAlternativePathsArtifact(index, malformedDirection), /direction is invalid/);

  const malformedReason = {
    ...structuredClone(result),
    truncated: true,
    truncationReason: "unknown" as never,
  };
  await assert.rejects(
    createSolveGraphAlternativePathsArtifact(index, malformedReason),
    /truncation reason is invalid/,
  );

  const malformedTruncation = { ...structuredClone(result), truncated: false, truncationReason: "depth" as const };
  await assert.rejects(createSolveGraphAlternativePathsArtifact(index, malformedTruncation), /truncation metadata/);
});

test("creates a safe browser-ready download", async () => {
  const { index, result } = await fixture();
  const download = await createSolveGraphAlternativePathsDownload("My Repo.zip", index, result);

  assert.equal(download.filename, "My-Repo-solvelang-alternative-paths.json");
  assert.equal(download.mediaType, "application/json;charset=utf-8");
  assert.deepEqual(JSON.parse(download.content), download.artifact);
  assert.equal(await verifyArtifactIntegrity(download.artifact), true);
});
