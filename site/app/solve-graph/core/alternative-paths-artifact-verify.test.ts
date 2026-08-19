import assert from "node:assert/strict";
import test from "node:test";

import { findSolveGraphAlternativePaths } from "./alternative-paths";
import {
  createSolveGraphAlternativePathsArtifact,
  serializeSolveGraphAlternativePathsArtifact,
} from "./alternative-paths-artifact";
import {
  MAX_SOLVE_GRAPH_ALTERNATIVE_PATH_ARTIFACT_BYTES,
  parseAndVerifySolveGraphAlternativePathsArtifact,
  verifySolveGraphAlternativePathsArtifact,
} from "./alternative-paths-artifact-verify";
import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";

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
    extractors: [{ id: "alternative-artifact-verifier-fixture", version: "1", deterministic: true }],
    nodes: [target, source, middle],
    edges: [second, direct, first],
  });
  const index = await createSolveGraphQueryIndex(document);
  const result = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const artifact = await createSolveGraphAlternativePathsArtifact(index, result);
  return { index, artifact };
}

test("round-trips a canonical graph-bound artifact into a detached verified artifact", async () => {
  const { index, artifact } = await fixture();
  const verified = await verifySolveGraphAlternativePathsArtifact(index, artifact);
  const parsed = await parseAndVerifySolveGraphAlternativePathsArtifact(
    index,
    serializeSolveGraphAlternativePathsArtifact(artifact),
  );

  assert.deepEqual(verified, artifact);
  assert.deepEqual(parsed, artifact);
  assert.notEqual(verified, artifact);
  assert.notEqual(verified.paths, artifact.paths);
  assert.equal(verified.execution.networkAccess, false);
  assert.equal(verified.execution.writeAccess, false);
});

test("rejects field tampering and integrity tampering", async () => {
  const { index, artifact } = await fixture();
  const changedField = structuredClone(artifact);
  changedField.statesCreated += 1;
  await assert.rejects(
    verifySolveGraphAlternativePathsArtifact(index, changedField),
    /integrity verification failed/,
  );

  const changedHash = structuredClone(artifact);
  changedHash.integrity.canonicalJsonSha256 = "0".repeat(64);
  await assert.rejects(
    verifySolveGraphAlternativePathsArtifact(index, changedHash),
    /integrity verification failed/,
  );
});

test("rejects noncanonical extra fields even when the original integrity hash is preserved", async () => {
  const { index, artifact } = await fixture();
  const withExtra = { ...structuredClone(artifact), unexpected: "not-covered-by-schema" };

  await assert.rejects(
    verifySolveGraphAlternativePathsArtifact(index, withExtra),
    /content is not canonical/,
  );
});

test("rejects graph mismatch and malformed path contracts", async () => {
  const { index, artifact } = await fixture();
  const otherGraph = { ...structuredClone(artifact), graphId: "sg_other_graph" };
  await assert.rejects(
    verifySolveGraphAlternativePathsArtifact(index, otherGraph),
    /different graph/,
  );

  const malformedPath = structuredClone(artifact);
  malformedPath.paths[0]!.nodeIds.push(malformedPath.sourceId);
  await assert.rejects(
    verifySolveGraphAlternativePathsArtifact(index, malformedPath),
    /validation failed/,
  );
});

test("bounds artifact text before parsing and rejects malformed JSON", async () => {
  const { index } = await fixture();
  await assert.rejects(
    parseAndVerifySolveGraphAlternativePathsArtifact(index, "{not-json}"),
    /JSON is malformed/,
  );

  const oversized = "x".repeat(MAX_SOLVE_GRAPH_ALTERNATIVE_PATH_ARTIFACT_BYTES + 1);
  await assert.rejects(
    parseAndVerifySolveGraphAlternativePathsArtifact(index, oversized),
    /exceeds the 1 MiB verification limit/,
  );
});
