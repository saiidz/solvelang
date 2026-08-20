import assert from "node:assert/strict";
import test from "node:test";
import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createAffectedValidationCandidates } from "./affected-validations";
import { analyzeSolveGraphImpact, createSolveGraphQueryIndex } from "./query-impact";

async function fixture() {
  const changed = await createSolveGraphNode({ kind: "file", identity: "file:src/core.ts", label: "src/core.ts", evidence: [{ kind: "parser", path: "src/core.ts" }] });
  const helper = await createSolveGraphNode({ kind: "module", identity: "module:src/helper", label: "src/helper", evidence: [{ kind: "parser", path: "src/helper.ts" }] });
  const testNode = await createSolveGraphNode({ kind: "test", identity: "test:core", label: "core test", evidence: [{ kind: "deterministic-analysis", path: "test/core.test.ts" }] });
  const workflow = await createSolveGraphNode({ kind: "workflow", identity: "workflow:ci", label: "CI", evidence: [{ kind: "workflow", path: ".github/workflows/ci.yml" }] });
  const job = await createSolveGraphNode({ kind: "job", identity: "job:ci:test", label: "test", evidence: [{ kind: "workflow", path: ".github/workflows/ci.yml" }] });
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "affected-validations-fixture", version: "1", deterministic: true }],
    nodes: [changed, helper, testNode, workflow, job],
    edges: [
      await createSolveGraphEdge({ kind: "imports", from: helper.id, to: changed.id, evidence: [{ kind: "parser", path: "src/helper.ts" }] }),
      await createSolveGraphEdge({ kind: "tests", from: testNode.id, to: changed.id, evidence: [{ kind: "deterministic-analysis", path: "test/core.test.ts" }] }),
      await createSolveGraphEdge({ kind: "triggers", from: workflow.id, to: changed.id, evidence: [{ kind: "workflow", path: ".github/workflows/ci.yml" }] }),
      await createSolveGraphEdge({ kind: "tests", from: job.id, to: helper.id, evidence: [{ kind: "workflow", path: ".github/workflows/ci.yml" }] }),
    ],
  });
  return { changed, helper, testNode, workflow, job, index: await createSolveGraphQueryIndex(document) };
}

test("selects deterministic test, workflow, and job candidates from bounded dependent impact", async () => {
  const { changed, testNode, workflow, job, index } = await fixture();
  const impact = analyzeSolveGraphImpact(index, [changed.id], { maxDepth: 4, maxResults: 200 });
  const result = createAffectedValidationCandidates(index, impact);
  assert.deepEqual(result.candidates.map((candidate) => candidate.node.id), [[testNode.id, workflow.id].sort(), job.id].flat());
  assert.deepEqual(result.candidates.map((candidate) => candidate.depth), [1, 1, 2]);
  assert.equal(result.summary.matchedCandidates, 3);
  assert.equal(result.queryTruncated, false);
  assert.equal(result.presentationTruncated, false);
  assert.match(result.notice, /candidate evidence/);
});

test("keeps validation presentation truncation distinct from bounded impact traversal", async () => {
  const { changed, index } = await fixture();
  const completeImpact = analyzeSolveGraphImpact(index, [changed.id], { maxDepth: 4, maxResults: 200 });
  const presentationBounded = createAffectedValidationCandidates(index, completeImpact, { maxCandidates: 1 });
  assert.equal(presentationBounded.queryTruncated, false);
  assert.equal(presentationBounded.presentationTruncated, true);
  assert.equal(presentationBounded.summary.hiddenCandidates, 2);

  const depthBoundedImpact = analyzeSolveGraphImpact(index, [changed.id], { maxDepth: 1, maxResults: 200 });
  const queryBounded = createAffectedValidationCandidates(index, depthBoundedImpact);
  assert.equal(queryBounded.queryTruncated, true);
  assert.equal(queryBounded.presentationTruncated, false);
  assert.match(queryBounded.notice, /may exist/);
});
