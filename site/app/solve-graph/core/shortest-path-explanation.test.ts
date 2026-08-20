import assert from "node:assert/strict";
import test from "node:test";

import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";
import { findSolveGraphShortestPath } from "./shortest-path";
import { createSolveGraphShortestPathExplanation } from "./shortest-path-explanation";
import { createSolveGraphShortestPathProductBundle } from "./shortest-path-product";

async function fixture() {
  const source = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/a.ts",
    label: "a.ts",
    evidence: [{ kind: "parser", path: "src/a.ts" }],
    metadata: { path: "src/a.ts" },
  });
  const middle = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/b.ts",
    label: "b.ts",
    evidence: [{ kind: "parser", path: "src/b.ts" }],
    metadata: { path: "src/b.ts" },
  });
  const target = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/c.ts",
    label: "c.ts",
    evidence: [{ kind: "parser", path: "src/c.ts" }],
    metadata: { path: "src/c.ts" },
  });
  const first = await createSolveGraphEdge({
    kind: "imports",
    from: source.id,
    to: middle.id,
    evidence: [{ kind: "parser", path: "src/a.ts" }],
  });
  const second = await createSolveGraphEdge({
    kind: "calls",
    from: middle.id,
    to: target.id,
    evidence: [{ kind: "parser", path: "src/b.ts" }],
  });
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "shortest-path-explanation-fixture", version: "1", deterministic: true }],
    nodes: [target, source, middle],
    edges: [second, first],
  });
  return { index: await createSolveGraphQueryIndex(document), source, target };
}

test("explains a found path as deterministic structural steps", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphShortestPath(index, source.id, target.id);
  const bundle = await createSolveGraphShortestPathProductBundle("repo.zip", index, result);

  const first = createSolveGraphShortestPathExplanation(bundle);
  const second = createSolveGraphShortestPathExplanation(structuredClone(bundle));

  assert.deepEqual(first, second);
  assert.equal(first.status, "complete");
  assert.equal(first.headline, "Dependency path found");
  assert.equal(first.summary.hopCount, 2);
  assert.deepEqual(first.steps.map((step) => step.edgeKind), ["imports", "calls"]);
  assert.deepEqual(first.steps.map((step) => step.sentence), [
    "a.ts --imports--> b.ts",
    "b.ts --calls--> c.ts",
  ]);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
});

test("preserves complete no-path truth without inventing steps", async () => {
  const { index, source, target } = await fixture();
  const bundle = await createSolveGraphShortestPathProductBundle(
    "repo.zip",
    index,
    findSolveGraphShortestPath(index, source.id, target.id, { edgeKinds: ["tests"] }),
  );

  const explanation = createSolveGraphShortestPathExplanation(bundle);
  assert.equal(explanation.found, false);
  assert.equal(explanation.status, "complete");
  assert.equal(explanation.headline, "No dependency path found");
  assert.equal(explanation.steps.length, 0);
  assert.match(explanation.detail, /completely searched configured graph scope/);
});

test("preserves partial bounded-search truth without claiming absence", async () => {
  const { index, source, target } = await fixture();
  const bundle = await createSolveGraphShortestPathProductBundle(
    "repo.zip",
    index,
    findSolveGraphShortestPath(index, source.id, target.id, { maxDepth: 0 }),
  );

  const explanation = createSolveGraphShortestPathExplanation(bundle);
  assert.equal(explanation.found, false);
  assert.equal(explanation.status, "partial");
  assert.equal(explanation.headline, "Dependency path search incomplete");
  assert.equal(explanation.execution.queryTruncated, true);
  assert.match(explanation.detail, /absence is not proven/);
  assert.match(explanation.notices.join(" "), /depth bound/);
});

test("explains identical endpoints as a zero-hop result", async () => {
  const { index, source } = await fixture();
  const bundle = await createSolveGraphShortestPathProductBundle(
    "repo.zip",
    index,
    findSolveGraphShortestPath(index, source.id, source.id),
  );

  const explanation = createSolveGraphShortestPathExplanation(bundle);
  assert.equal(explanation.headline, "Source and target are the same node");
  assert.equal(explanation.summary.hopCount, 0);
  assert.equal(explanation.steps.length, 0);
  assert.match(explanation.detail, /resolved immediately/);
});

test("rejects tampered path identity and capability truth", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphShortestPath(index, source.id, target.id);
  const bundle = await createSolveGraphShortestPathProductBundle("repo.zip", index, result);

  const tamperedHop = structuredClone(bundle);
  tamperedHop.presentation.hops[0]!.to = target.id;
  assert.throws(
    () => createSolveGraphShortestPathExplanation(tamperedHop),
    /mismatched hop evidence/,
  );

  const tamperedCapability = structuredClone(bundle);
  (tamperedCapability.execution as unknown as { networkAccess: boolean }).networkAccess = true;
  assert.throws(
    () => createSolveGraphShortestPathExplanation(tamperedCapability),
    /capability-free product inputs/,
  );
});
