import assert from "node:assert/strict";
import test from "node:test";
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "../../solve-graph/core/canonical";
import type { SolveGraphNode } from "../../solve-graph/core/contracts";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import { createRepositoryDeadCodeCandidateAnalysis } from "./deadCodeCandidates";

async function sourceFile(path: string, metadata: Record<string, string | number | boolean> = {}): Promise<SolveGraphNode> {
  return createSolveGraphNode({
    kind: "file",
    identity: `file:${path}`,
    label: path.slice(path.lastIndexOf("/") + 1),
    evidence: [{ kind: "deterministic-analysis", path }],
    metadata: { path, fileClass: "source", ...metadata },
  });
}

async function graph(options: {
  paths?: string[];
  importedPath?: string;
  extractorId?: string;
  partial?: boolean;
} = {}) {
  const paths = options.paths ?? ["src/index.ts", "src/helper.ts", "src/orphan.ts"];
  const nodes = await Promise.all(paths.map((path) => sourceFile(path)));
  const byPath = new Map(nodes.map((node) => [node.metadata?.path, node]));
  const edges = [];
  const importedPath = options.importedPath ?? "src/helper.ts";
  const entry = byPath.get("src/index.ts");
  const imported = byPath.get(importedPath);
  if (entry && imported) {
    edges.push(await createSolveGraphEdge({
      kind: "imports",
      from: entry.id,
      to: imported.id,
      evidence: [{ kind: "parser", path: "src/index.ts", line: 1, column: 1 }],
    }));
  }
  return createSolveGraphDocument({
    source: solveGraphFixtureSource,
    extractors: [{ id: options.extractorId ?? "javascript-imports", version: "1.0.0", deterministic: true }],
    ...(options.partial ? { status: "partial" as const, truncationReasons: ["edge-count" as const] } : {}),
    nodes,
    edges,
  });
}

test("reports only unreferenced eligible source files as conservative candidates", async () => {
  const document = await graph();
  const analysis = await createRepositoryDeadCodeCandidateAnalysis(document);

  assert.equal(analysis.status, "complete");
  assert.deepEqual(analysis.candidates.map((candidate) => candidate.path), ["src/orphan.ts"]);
  assert.equal(analysis.candidates[0].basis, "no-observed-incoming-references");
  assert.equal(analysis.candidates[0].observedIncomingReferences, 0);
  assert.match(analysis.candidates[0].candidateId, /^dead-code:sgn_/);
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);
});

test("excludes generated files, operational entrypoints, and framework convention entrypoints", async () => {
  const index = await sourceFile("src/index.ts");
  const page = await sourceFile("app/dashboard/page.tsx");
  const generated = await sourceFile("src/generated.ts", { generated: true });
  const regular = await sourceFile("src/regular.ts");
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    extractors: [{ id: "javascript-imports", version: "1.0.0", deterministic: true }],
    nodes: [index, page, generated, regular],
    edges: [],
  });

  const analysis = await createRepositoryDeadCodeCandidateAnalysis(document);
  assert.deepEqual(analysis.candidates.map((candidate) => candidate.path), ["src/regular.ts"]);
});

test("suppresses candidates when bounded graph evidence is partial", async () => {
  const analysis = await createRepositoryDeadCodeCandidateAnalysis(await graph({ partial: true }));
  assert.equal(analysis.status, "suppressed");
  assert.equal(analysis.suppressionReason, "partial-graph");
  assert.deepEqual(analysis.candidates, []);
});

test("suppresses candidates when JavaScript import evidence is unavailable", async () => {
  const analysis = await createRepositoryDeadCodeCandidateAnalysis(await graph({ extractorId: "inventory" }));
  assert.equal(analysis.status, "suppressed");
  assert.equal(analysis.suppressionReason, "javascript-import-evidence-unavailable");
  assert.deepEqual(analysis.candidates, []);
});

test("candidate ordering and output bounds are deterministic", async () => {
  const document = await graph({ paths: ["src/zeta.ts", "src/alpha.ts"] });
  const first = await createRepositoryDeadCodeCandidateAnalysis(document, { maxCandidates: 1 });
  const second = await createRepositoryDeadCodeCandidateAnalysis(document, { maxCandidates: 1 });
  assert.deepEqual(first, second);
  assert.deepEqual(first.candidates.map((candidate) => candidate.path), ["src/alpha.ts"]);
  assert.equal(first.execution.candidatesTruncated, true);
  await assert.rejects(
    createRepositoryDeadCodeCandidateAnalysis(document, { maxCandidates: 1_001 }),
    /maxCandidates/,
  );
});

test("integrity-invalid graph input fails closed", async () => {
  const document = await graph();
  const tampered = structuredClone(document);
  tampered.nodes[0].label = "tampered";
  await assert.rejects(createRepositoryDeadCodeCandidateAnalysis(tampered), /integrity-valid/);
});
