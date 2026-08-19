import assert from "node:assert/strict";
import test from "node:test";

import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { findSolveGraphShortestPath } from "./shortest-path";
import { createSolveGraphShortestPathArtifact, serializeSolveGraphShortestPathArtifact } from "./shortest-path-artifact";
import {
  MAX_SOLVE_GRAPH_SHORTEST_PATH_ARTIFACT_BYTES,
  parseAndVerifySolveGraphShortestPathArtifact,
  verifySolveGraphShortestPathArtifact,
} from "./shortest-path-artifact-verify";

async function fixture() {
  const source = await createSolveGraphNode({ kind: "file", identity: "file:src/a.ts", label: "a.ts", evidence: [{ kind: "parser", path: "src/a.ts" }] });
  const target = await createSolveGraphNode({ kind: "file", identity: "file:src/b.ts", label: "b.ts", evidence: [{ kind: "parser", path: "src/b.ts" }] });
  const edge = await createSolveGraphEdge({ kind: "imports", from: source.id, to: target.id, evidence: [{ kind: "parser", path: "src/a.ts" }] });
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "shortest-path-verifier-fixture", version: "1", deterministic: true }],
    nodes: [target, source],
    edges: [edge],
  });
  const index = await createSolveGraphQueryIndex(document);
  const result = findSolveGraphShortestPath(index, source.id, target.id);
  const artifact = await createSolveGraphShortestPathArtifact(index, result);
  return { index, artifact };
}

test("round-trips a canonical shortest-path artifact into detached verified evidence", async () => {
  const { index, artifact } = await fixture();
  const verified = await verifySolveGraphShortestPathArtifact(index, artifact);
  const parsed = await parseAndVerifySolveGraphShortestPathArtifact(
    index,
    serializeSolveGraphShortestPathArtifact(artifact),
  );

  assert.deepEqual(verified, artifact);
  assert.deepEqual(parsed, artifact);
  assert.notEqual(verified, artifact);
  assert.notEqual(verified.nodeIds, artifact.nodeIds);
  assert.notEqual(verified.hops, artifact.hops);
  assert.equal(verified.execution.networkAccess, false);
  assert.equal(verified.execution.writeAccess, false);
});

test("rejects field and integrity tampering", async () => {
  const { index, artifact } = await fixture();
  const changedField = structuredClone(artifact);
  changedField.visitedCount += 1;
  await assert.rejects(
    verifySolveGraphShortestPathArtifact(index, changedField),
    /integrity verification failed/,
  );

  const changedHash = structuredClone(artifact);
  changedHash.integrity.canonicalJsonSha256 = "0".repeat(64);
  await assert.rejects(
    verifySolveGraphShortestPathArtifact(index, changedHash),
    /integrity verification failed/,
  );
});

test("rejects extra fields, wrong graph identity, and malformed path contracts", async () => {
  const { index, artifact } = await fixture();
  await assert.rejects(
    verifySolveGraphShortestPathArtifact(index, { ...structuredClone(artifact), unexpected: true }),
    /content is not canonical/,
  );

  await assert.rejects(
    verifySolveGraphShortestPathArtifact(index, { ...structuredClone(artifact), graphId: "sg_other_graph" }),
    /different graph/,
  );

  const malformed = structuredClone(artifact);
  malformed.hops[0]!.edgeId = "sge_missing";
  await assert.rejects(
    verifySolveGraphShortestPathArtifact(index, malformed),
    /validation failed/,
  );
});

test("bounds artifact text before parsing and rejects malformed JSON", async () => {
  const { index } = await fixture();
  await assert.rejects(
    parseAndVerifySolveGraphShortestPathArtifact(index, "{not-json}"),
    /JSON is malformed/,
  );

  await assert.rejects(
    parseAndVerifySolveGraphShortestPathArtifact(
      index,
      "x".repeat(MAX_SOLVE_GRAPH_SHORTEST_PATH_ARTIFACT_BYTES + 1),
    ),
    /exceeds the 1 MiB verification limit/,
  );
});
