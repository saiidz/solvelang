import assert from "node:assert/strict";
import test from "node:test";
import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { findLocalUnreachedCandidates } from "./unreachable-candidates";

async function fixture(options: { partial?: boolean } = {}) {
  const root = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/root.ts",
    label: "src/root.ts",
    evidence: [{ kind: "parser", path: "src/root.ts" }],
  });
  const reached = await createSolveGraphNode({
    kind: "module",
    identity: "module:src/reached",
    label: "src/reached",
    evidence: [{ kind: "parser", path: "src/reached.ts" }],
  });
  const hiddenA = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/hidden-a.ts",
    label: "src/hidden-a.ts",
    evidence: [{ kind: "parser", path: "src/hidden-a.ts" }],
  });
  const hiddenB = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/hidden-b.ts",
    label: "src/hidden-b.ts",
    evidence: [{ kind: "parser", path: "src/hidden-b.ts" }],
  });
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "unreached-candidates-fixture", version: "1", deterministic: true }],
    ...(options.partial ? { status: "partial" as const, truncationReasons: ["edge-count" as const] } : {}),
    nodes: [root, reached, hiddenA, hiddenB],
    edges: [
      await createSolveGraphEdge({
        kind: "imports",
        from: root.id,
        to: reached.id,
        evidence: [{ kind: "parser", path: "src/root.ts" }],
      }),
    ],
  });
  return {
    root,
    reached,
    hiddenA,
    hiddenB,
    index: await createSolveGraphQueryIndex(document),
  };
}

test("returns stable bounded structural unreached candidates", async () => {
  const { root, hiddenA, hiddenB, index } = await fixture();
  const result = findLocalUnreachedCandidates(index, [root.id]);

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.id),
    [hiddenA.id, hiddenB.id].sort(),
  );
  assert.equal(result.summary.matchedCandidates, 2);
  assert.equal(result.summary.hiddenCandidates, 0);
  assert.equal(result.queryTruncated, false);
  assert.equal(result.presentationTruncated, false);
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
  assert.match(result.notice, /static structural candidates/);
  assert.match(result.notice, /does not establish runtime unreachability/);
});

test("keeps bounded traversal uncertainty explicit", async () => {
  const { root, reached, index } = await fixture();
  const result = findLocalUnreachedCandidates(index, [root.id], { maxDepth: 0 });

  assert.equal(result.queryTruncated, true);
  assert.equal(result.truncated, true);
  assert.ok(result.candidates.some((candidate) => candidate.id === reached.id));
  assert.match(result.notice, /traversal stopped early/);
  assert.match(result.notice, /may still be structurally reached/);
});

test("keeps presentation bounds distinct from traversal bounds", async () => {
  const { root, index } = await fixture();
  const result = findLocalUnreachedCandidates(index, [root.id], { maxCandidates: 1 });

  assert.equal(result.queryTruncated, false);
  assert.equal(result.presentationTruncated, true);
  assert.equal(result.summary.matchedCandidates, 2);
  assert.equal(result.summary.returnedCandidates, 1);
  assert.equal(result.summary.hiddenCandidates, 1);
  assert.match(result.notice, /Showing 1 of 2/);
  assert.throws(
    () => findLocalUnreachedCandidates(index, [root.id], { maxCandidates: 101 }),
    /maxCandidates/,
  );
});

test("surfaces partial source-graph truth separately", async () => {
  const { root, index } = await fixture({ partial: true });
  const result = findLocalUnreachedCandidates(index, [root.id]);

  assert.equal(result.sourcePartial, true);
  assert.equal(result.queryTruncated, false);
  assert.equal(result.truncated, true);
  assert.match(result.notice, /source graph is partial or truncated/);
  assert.match(result.notice, /missing relationships may change observed reachability/);
});
