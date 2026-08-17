import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "../../repository-audit/core/inventory";
import { serializeSolveGraphDocument } from "./canonical";
import { scanJavaScriptImportSpecifiers, extractRepositoryDependencyGraph } from "./import-extractor";
import { createSolveGraphQueryIndex, analyzeSolveGraphImpact } from "./query-impact";

function snapshot(files: RepositorySnapshot["files"]): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "import-fixture",
      revision: "fixture-v1",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    files,
  };
}

function file(path: string, text: string): RepositorySnapshot["files"][number] {
  return { path, text, byteSize: new TextEncoder().encode(text).byteLength };
}

function nodeByPath(graph: Awaited<ReturnType<typeof extractRepositoryDependencyGraph>>, path: string) {
  return graph.nodes.find((node) => node.kind === "file" && node.metadata?.path === path);
}

test("lexical import scan recognizes supported forms while ignoring comments, strings, and import.meta", () => {
  const source = [
    'import value from "./value";',
    'import "./side-effect";',
    'export { item } from "./exported";',
    'const lazy = import("./lazy");',
    'const legacy = require("legacy-package");',
    'const text = \'import "fake-string"\';',
    '// import "fake-line-comment";',
    '/* require("fake-block-comment") */',
    'const url = import.meta.url;',
  ].join("\n");

  assert.deepEqual(
    scanJavaScriptImportSpecifiers(source).map(({ form, specifier, line }) => ({ form, specifier, line })),
    [
      { form: "static", specifier: "./value", line: 1 },
      { form: "static", specifier: "./side-effect", line: 2 },
      { form: "export", specifier: "./exported", line: 3 },
      { form: "dynamic", specifier: "./lazy", line: 4 },
      { form: "require", specifier: "legacy-package", line: 5 },
    ],
  );
});

test("dependency graph resolves local TypeScript imports, index modules, Node builtins, and declared packages", async () => {
  const repository = snapshot([
    file("package.json", JSON.stringify({ dependencies: { react: "19.0.0" } })),
    file("src/lib.ts", "export const lib = 1;"),
    file("src/data/index.ts", "export const data = 2;"),
    file("src/main.ts", [
      'import { lib } from "./lib.js";',
      'export { data } from "./data";',
      'const React = await import("react");',
      'const fs = require("node:fs");',
      'import alias from "@/not-a-declared-package";',
      'import missing from "./missing";',
    ].join("\n")),
  ]);

  const graph = await extractRepositoryDependencyGraph(repository);
  const main = nodeByPath(graph, "src/main.ts");
  const lib = nodeByPath(graph, "src/lib.ts");
  const data = nodeByPath(graph, "src/data/index.ts");
  assert.ok(main && lib && data);

  const dependencyNames = graph.nodes
    .filter((node) => node.kind === "dependency")
    .map((node) => node.metadata?.packageName)
    .sort();
  assert.deepEqual(dependencyNames, ["node:fs", "react"]);

  const importEdges = graph.edges.filter((edge) => edge.kind === "imports" && edge.from === main.id);
  assert.equal(importEdges.length, 4);
  assert.ok(importEdges.some((edge) => edge.to === lib.id && edge.qualifier === "static:./lib.js"));
  assert.ok(importEdges.some((edge) => edge.to === data.id && edge.qualifier === "export:./data"));
  assert.ok(importEdges.some((edge) => graph.nodes.find((node) => node.id === edge.to)?.metadata?.packageName === "react"));
  assert.ok(importEdges.some((edge) => graph.nodes.find((node) => node.id === edge.to)?.metadata?.packageName === "node:fs"));
  assert.equal(importEdges.some((edge) => edge.qualifier?.includes("@/not-a-declared-package")), false);
  assert.equal(importEdges.some((edge) => edge.qualifier?.includes("./missing")), false);
});

test("import edges immediately feed deterministic blast-radius analysis", async () => {
  const repository = snapshot([
    file("src/lib.ts", "export const lib = 1;"),
    file("src/service.ts", 'import { lib } from "./lib"; export const service = lib;'),
    file("src/route.ts", 'import { service } from "./service"; export const route = service;'),
  ]);
  const graph = await extractRepositoryDependencyGraph(repository);
  const index = await createSolveGraphQueryIndex(graph);
  const lib = nodeByPath(graph, "src/lib.ts")!;
  const service = nodeByPath(graph, "src/service.ts")!;
  const route = nodeByPath(graph, "src/route.ts")!;

  const impact = analyzeSolveGraphImpact(index, [lib.id]);
  assert.deepEqual(impact.entries.map((entry) => entry.id), [lib.id, service.id, route.id]);
  assert.deepEqual(impact.entries.map((entry) => entry.depth), [0, 1, 2]);
  assert.equal(impact.truncated, false);
});

test("equivalent reordered snapshots produce identical canonical dependency graphs", async () => {
  const files = [
    file("package.json", JSON.stringify({ devDependencies: { typescript: "5.9.2" } })),
    file("src/a.ts", 'import type { B } from "./b"; export type A = B;'),
    file("src/b.ts", "export type B = string;"),
    file("src/tool.ts", 'const ts = require("typescript"); export default ts;'),
  ];
  const left = await extractRepositoryDependencyGraph(snapshot(files));
  const right = await extractRepositoryDependencyGraph(snapshot([...files].reverse()));
  assert.equal(serializeSolveGraphDocument(left), serializeSolveGraphDocument(right));
  assert.equal(left.graphId, right.graphId);
});

test("dependency-node and import-edge limits fail closed with explicit truncation reasons", async () => {
  const dependencyRepository = snapshot([
    file("package.json", JSON.stringify({ dependencies: { react: "19.0.0" } })),
    file("main.ts", 'import React from "react"; export default React;'),
  ]);
  const nodeBound = await extractRepositoryDependencyGraph(dependencyRepository, {
    limits: {
      maxFiles: 10,
      maxTotalBytes: 1_000_000,
      maxFileBytes: 1_000_000,
      maxDepth: 8,
      maxNodes: 3,
      maxEdges: 10,
      maxEvidencePerElement: 16,
      maxMetadataEntries: 16,
      maxMetadataStringBytes: 4_096,
      maxIdentityBytes: 4_096,
    },
  });
  assert.equal(nodeBound.execution.status, "partial");
  assert.ok(nodeBound.execution.truncationReasons.includes("node-count"));
  assert.equal(nodeBound.nodes.some((node) => node.kind === "dependency"), false);

  const localRepository = snapshot([
    file("a.ts", 'import "./b";'),
    file("b.ts", "export const b = 1;"),
  ]);
  const edgeBound = await extractRepositoryDependencyGraph(localRepository, {
    limits: {
      maxFiles: 10,
      maxTotalBytes: 1_000_000,
      maxFileBytes: 1_000_000,
      maxDepth: 8,
      maxNodes: 10,
      maxEdges: 2,
      maxEvidencePerElement: 16,
      maxMetadataEntries: 16,
      maxMetadataStringBytes: 4_096,
      maxIdentityBytes: 4_096,
    },
  });
  assert.equal(edgeBound.execution.status, "partial");
  assert.ok(edgeBound.execution.truncationReasons.includes("edge-count"));
});
