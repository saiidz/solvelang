import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "../../repository-audit/core/inventory";
import { analyzeRepositoryGraph } from "../../repository-audit/core/graphPipeline";
import { serializeSolveGraphDocument } from "./canonical";
import { extractRepositoryMultiLanguageDependencyGraph } from "./dependency-extractor";
import { scanPhpLocalImportSpecifiers } from "./php-import-extractor";
import { analyzeSolveGraphImpact, createSolveGraphQueryIndex } from "./query-impact";

function snapshot(files: RepositorySnapshot["files"]): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "php-import-fixture",
      revision: "fixture-v1",
      fingerprint: `sha256:${"d".repeat(64)}`,
    },
    files,
  };
}

function file(path: string, text: string): RepositorySnapshot["files"][number] {
  return { path, text, byteSize: new TextEncoder().encode(text).byteLength };
}

function nodeByPath(
  graph: Awaited<ReturnType<typeof extractRepositoryMultiLanguageDependencyGraph>>,
  path: string,
) {
  return graph.nodes.find((node) => node.kind === "file" && node.metadata?.path === path);
}

test("PHP lexical scan accepts only explicit relative literal imports inside PHP code", () => {
  const source = [
    "<html>require './fake-html.php';</html>",
    "<?php",
    "// require './fake-comment.php';",
    "$text = \"include './fake-string.php';\";",
    "require './config.php';",
    "include_once('../shared/util.php');",
    "require $dynamic;",
    "include 'bare.php';",
    "?>",
    "require './fake-tail.php';",
  ].join("\n");

  assert.deepEqual(
    scanPhpLocalImportSpecifiers(source),
    [
      { form: "require", specifier: "./config.php", line: 5, column: 1 },
      { form: "include_once", specifier: "../shared/util.php", line: 6, column: 1 },
    ],
  );
});

test("multi-language graph resolves local PHP literal imports without inventing dynamic dependencies", async () => {
  const repository = snapshot([
    file("app/config.php", "<?php return ['retry' => 3];\n"),
    file("shared/util.php", "<?php function helper() {}\n"),
    file("app/main.php", [
      "<?php",
      "require './config.php';",
      "include_once '../shared/util.php';",
      "require $dynamic;",
      "include 'vendor/autoload.php';",
    ].join("\n")),
  ]);

  const graph = await extractRepositoryMultiLanguageDependencyGraph(repository);
  const main = nodeByPath(graph, "app/main.php");
  const config = nodeByPath(graph, "app/config.php");
  const util = nodeByPath(graph, "shared/util.php");
  assert.ok(main && config && util);
  assert.ok(graph.extractors.some((extractor) => extractor.id === "php-local-imports"));

  const importEdges = graph.edges.filter((edge) => edge.kind === "imports" && edge.from === main.id);
  assert.equal(importEdges.length, 2);
  assert.ok(importEdges.some((edge) => edge.to === config.id && edge.qualifier === "php:require:./config.php"));
  assert.ok(importEdges.some((edge) => edge.to === util.id && edge.qualifier === "php:include_once:../shared/util.php"));
  assert.equal(graph.nodes.some((node) => node.kind === "dependency" && node.label === "vendor/autoload.php"), false);
});

test("Repository Audit graph pipeline includes PHP local relationships in bounded impact", async () => {
  const repository = snapshot([
    file("lib/value.php", "<?php return 1;\n"),
    file("service/service.php", "<?php require '../lib/value.php';\n"),
    file("route.php", "<?php require './service/service.php';\n"),
  ]);
  const result = await analyzeRepositoryGraph(repository);
  const graph = result.graph;
  const value = nodeByPath(graph, "lib/value.php");
  const service = nodeByPath(graph, "service/service.php");
  const route = nodeByPath(graph, "route.php");
  assert.ok(value && service && route);

  const index = await createSolveGraphQueryIndex(graph);
  const impact = analyzeSolveGraphImpact(index, [value.id]);
  assert.deepEqual(impact.entries.map((entry) => entry.id), [value.id, service.id, route.id]);
  assert.deepEqual(impact.entries.map((entry) => entry.depth), [0, 1, 2]);
  assert.equal(result.execution.status, "complete");
});

test("equivalent reordered PHP snapshots produce identical canonical graphs", async () => {
  const files = [
    file("a.php", "<?php require './b.php';\n"),
    file("b.php", "<?php return 'b';\n"),
  ];
  const left = await extractRepositoryMultiLanguageDependencyGraph(snapshot(files));
  const right = await extractRepositoryMultiLanguageDependencyGraph(snapshot([...files].reverse()));
  assert.equal(serializeSolveGraphDocument(left), serializeSolveGraphDocument(right));
  assert.equal(left.graphId, right.graphId);
});

test("PHP import relationships honor the shared edge bound and fail closed as partial", async () => {
  const repository = snapshot([
    file("a.php", "<?php require './b.php';\n"),
    file("b.php", "<?php return 1;\n"),
  ]);
  const graph = await extractRepositoryMultiLanguageDependencyGraph(repository, {
    limits: {
      maxFiles: 10,
      maxTotalBytes: 1_000_000,
      maxFileBytes: 1_000_000,
      maxDepth: 8,
      maxNodes: 10,
      maxEdges: 3,
      maxEvidencePerElement: 16,
      maxMetadataEntries: 16,
      maxMetadataStringBytes: 4_096,
      maxIdentityBytes: 4_096,
    },
  });
  assert.equal(graph.execution.status, "partial");
  assert.ok(graph.execution.truncationReasons.includes("edge-count"));
});
