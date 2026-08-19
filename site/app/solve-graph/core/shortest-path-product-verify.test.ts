import assert from "node:assert/strict";
import test from "node:test";

import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { findSolveGraphShortestPath } from "./shortest-path";
import { createSolveGraphShortestPathProductBundle } from "./shortest-path-product";
import {
  MAX_SOLVE_GRAPH_SHORTEST_PATH_PRODUCT_BYTES,
  parseAndVerifySolveGraphShortestPathProductBundle,
  verifySolveGraphShortestPathProductBundle,
} from "./shortest-path-product-verify";

async function fixture() {
  const source = await createSolveGraphNode({ kind: "file", identity: "file:src/a.ts", label: "a.ts", evidence: [{ kind: "parser", path: "src/a.ts" }], metadata: { path: "src/a.ts" } });
  const target = await createSolveGraphNode({ kind: "file", identity: "file:src/b.ts", label: "b.ts", evidence: [{ kind: "parser", path: "src/b.ts" }], metadata: { path: "src/b.ts" } });
  const edge = await createSolveGraphEdge({ kind: "imports", from: source.id, to: target.id, evidence: [{ kind: "parser", path: "src/a.ts" }] });
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "shortest-product-verifier-fixture", version: "1", deterministic: true }],
    nodes: [target, source],
    edges: [edge],
  });
  const index = await createSolveGraphQueryIndex(document);
  const result = findSolveGraphShortestPath(index, source.id, target.id);
  const product = await createSolveGraphShortestPathProductBundle("repo.zip", index, result);
  return { index, product };
}

test("round-trips one canonical product into detached verified output", async () => {
  const { index, product } = await fixture();
  const verified = await verifySolveGraphShortestPathProductBundle("repo.zip", index, product);
  const parsed = await parseAndVerifySolveGraphShortestPathProductBundle(
    "repo.zip",
    index,
    JSON.stringify(product),
  );

  assert.deepEqual(verified, product);
  assert.deepEqual(parsed, product);
  assert.notEqual(verified, product);
  assert.notEqual(verified.download.artifact, product.download.artifact);
  assert.notEqual(verified.presentation, product.presentation);
  assert.equal(verified.execution.networkAccess, false);
  assert.equal(verified.execution.writeAccess, false);
});

test("rejects embedded artifact, presentation, filename, and status tampering", async () => {
  const { index, product } = await fixture();

  const artifactTamper = structuredClone(product);
  artifactTamper.download.artifact.visitedCount += 1;
  await assert.rejects(
    verifySolveGraphShortestPathProductBundle("repo.zip", index, artifactTamper),
    /integrity verification failed/,
  );

  const presentationTamper = structuredClone(product);
  presentationTamper.presentation.summary.visitedCount += 1;
  await assert.rejects(
    verifySolveGraphShortestPathProductBundle("repo.zip", index, presentationTamper),
    /product content verification failed/,
  );

  const filenameTamper = structuredClone(product);
  filenameTamper.download.filename = "other.json";
  await assert.rejects(
    verifySolveGraphShortestPathProductBundle("repo.zip", index, filenameTamper),
    /product content verification failed/,
  );

  const statusTamper = structuredClone(product);
  statusTamper.status = "partial";
  await assert.rejects(
    verifySolveGraphShortestPathProductBundle("repo.zip", index, statusTamper),
    /product content verification failed/,
  );
});

test("rejects source-name mismatch, extra fields, and wrong graph identity", async () => {
  const { index, product } = await fixture();
  await assert.rejects(
    verifySolveGraphShortestPathProductBundle("different.zip", index, product),
    /product content verification failed/,
  );
  await assert.rejects(
    verifySolveGraphShortestPathProductBundle("repo.zip", index, { ...structuredClone(product), unexpected: true }),
    /product content verification failed/,
  );
  await assert.rejects(
    verifySolveGraphShortestPathProductBundle("repo.zip", index, { ...structuredClone(product), graphId: "sg_other_graph" }),
    /different graph/,
  );
});

test("bounds product text before parsing and rejects malformed JSON", async () => {
  const { index } = await fixture();
  await assert.rejects(
    parseAndVerifySolveGraphShortestPathProductBundle("repo.zip", index, "{not-json}"),
    /JSON is malformed/,
  );
  await assert.rejects(
    parseAndVerifySolveGraphShortestPathProductBundle(
      "repo.zip",
      index,
      "x".repeat(MAX_SOLVE_GRAPH_SHORTEST_PATH_PRODUCT_BYTES + 1),
    ),
    /exceeds the 2 MiB verification limit/,
  );
});
