import assert from "node:assert/strict";
import test from "node:test";

import { findSolveGraphAlternativePaths } from "./alternative-paths";
import { createSolveGraphAlternativePathsExplanation } from "./alternative-paths-explanation";
import { createSolveGraphAlternativePathsProductBundle } from "./alternative-paths-product";
import { createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphQueryIndex } from "./query-impact";

async function fixture() {
  const source = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/a.ts",
    label: "a.ts",
    evidence: [{ kind: "parser", path: "src/a.ts" }],
    metadata: { path: "src/a.ts" },
  });
  const left = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/b.ts",
    label: "b.ts",
    evidence: [{ kind: "parser", path: "src/b.ts" }],
    metadata: { path: "src/b.ts" },
  });
  const right = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/c.ts",
    label: "c.ts",
    evidence: [{ kind: "parser", path: "src/c.ts" }],
    metadata: { path: "src/c.ts" },
  });
  const target = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/d.ts",
    label: "d.ts",
    evidence: [{ kind: "parser", path: "src/d.ts" }],
    metadata: { path: "src/d.ts" },
  });
  const edges = [
    await createSolveGraphEdge({ kind: "imports", from: source.id, to: target.id, evidence: [{ kind: "parser", path: "src/a.ts" }] }),
    await createSolveGraphEdge({ kind: "imports", from: source.id, to: left.id, evidence: [{ kind: "parser", path: "src/a.ts" }] }),
    await createSolveGraphEdge({ kind: "calls", from: left.id, to: target.id, evidence: [{ kind: "parser", path: "src/b.ts" }] }),
    await createSolveGraphEdge({ kind: "imports", from: source.id, to: right.id, evidence: [{ kind: "parser", path: "src/a.ts" }] }),
    await createSolveGraphEdge({ kind: "calls", from: right.id, to: target.id, evidence: [{ kind: "parser", path: "src/c.ts" }] }),
  ];
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "alternative-explanation-fixture", version: "1", deterministic: true }],
    nodes: [target, right, source, left],
    edges: [edges[4], edges[2], edges[0], edges[3], edges[1]],
  });
  return { index: await createSolveGraphQueryIndex(document), source, target };
}

test("explains complete alternative paths deterministically", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const bundle = await createSolveGraphAlternativePathsProductBundle("repo.zip", index, result);

  const first = createSolveGraphAlternativePathsExplanation(bundle);
  const second = createSolveGraphAlternativePathsExplanation(structuredClone(bundle));

  assert.deepEqual(first, second);
  assert.equal(first.status, "complete");
  assert.equal(first.headline, "3 dependency paths observed");
  assert.equal(first.summary.availablePaths, 3);
  assert.equal(first.summary.explainedPaths, 3);
  assert.deepEqual(first.paths.map((path) => path.hopCount), [1, 2, 2]);
  assert.equal(first.paths[0]!.steps[0]!.sentence, "a.ts --imports--> d.ts");
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
});

test("preserves query truncation without claiming the path set is complete", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphAlternativePaths(index, source.id, target.id, {
    edgeKinds: ["imports", "calls"],
    maxPaths: 1,
  });
  const bundle = await createSolveGraphAlternativePathsProductBundle("repo.zip", index, result);

  const explanation = createSolveGraphAlternativePathsExplanation(bundle);
  assert.equal(explanation.status, "partial");
  assert.equal(explanation.execution.queryTruncated, true);
  assert.equal(explanation.execution.presentationRowsTruncated, false);
  assert.match(explanation.headline, /evidence is partial/);
  assert.match(explanation.detail, /additional paths may exist/);
  assert.match(explanation.notices.join(" "), /path-count bound/);
});

test("keeps presentation truncation distinct from query truncation", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const bundle = await createSolveGraphAlternativePathsProductBundle("repo.zip", index, result, { maxPaths: 1 });

  const explanation = createSolveGraphAlternativePathsExplanation(bundle);
  assert.equal(explanation.status, "partial");
  assert.equal(explanation.execution.queryTruncated, false);
  assert.equal(explanation.execution.presentationRowsTruncated, true);
  assert.equal(explanation.summary.availablePaths, 3);
  assert.equal(explanation.summary.explainedPaths, 1);
  assert.equal(explanation.summary.hiddenPaths, 2);
  assert.match(explanation.detail, /presentation explains 1 and hides 2/);
});

test("explains identical endpoints as one zero-hop path", async () => {
  const { index, source } = await fixture();
  const result = findSolveGraphAlternativePaths(index, source.id, source.id);
  const bundle = await createSolveGraphAlternativePathsProductBundle("repo.zip", index, result);

  const explanation = createSolveGraphAlternativePathsExplanation(bundle);
  assert.equal(explanation.status, "complete");
  assert.equal(explanation.headline, "Source and target are the same node");
  assert.equal(explanation.paths.length, 1);
  assert.equal(explanation.paths[0]!.hopCount, 0);
  assert.equal(explanation.paths[0]!.steps.length, 0);
  assert.match(explanation.paths[0]!.sentence, /both the source and target/);
});

test("rejects tampered visible-path evidence and capabilities", async () => {
  const { index, source, target } = await fixture();
  const result = findSolveGraphAlternativePaths(index, source.id, target.id, { edgeKinds: ["imports", "calls"] });
  const bundle = await createSolveGraphAlternativePathsProductBundle("repo.zip", index, result);

  const tamperedHop = structuredClone(bundle);
  tamperedHop.presentation.rows[0]!.hops[0]!.edgeId = "sge_tampered";
  assert.throws(
    () => createSolveGraphAlternativePathsExplanation(tamperedHop),
    /mismatched hop evidence/,
  );

  const tamperedCapability = structuredClone(bundle);
  (tamperedCapability.execution as unknown as { networkAccess: boolean }).networkAccess = true;
  assert.throws(
    () => createSolveGraphAlternativePathsExplanation(tamperedCapability),
    /capability-free product inputs/,
  );
});
