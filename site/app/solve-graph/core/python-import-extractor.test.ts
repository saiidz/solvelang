import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "../../repository-audit/core/inventory";
import { analyzeRepositoryGraph } from "../../repository-audit/core/graphPipeline";
import { serializeSolveGraphDocument } from "./canonical";
import { extractRepositoryMultiLanguageDependencyGraph } from "./dependency-extractor";
import { scanPythonImportSpecifiers } from "./python-import-extractor";
import { analyzeSolveGraphImpact, createSolveGraphQueryIndex } from "./query-impact";

function snapshot(files: RepositorySnapshot["files"]): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "python-import-fixture",
      revision: "fixture-v1",
      fingerprint: `sha256:${"b".repeat(64)}`,
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

test("Python lexical import scan ignores comments and strings while retaining deterministic locations", () => {
  const source = [
    '"""',
    "import fake_docstring",
    '"""',
    "import os, pkg.util as util",
    "from .helper import value",
    'text = "from fake_string import nope"',
    "# import fake_comment",
    "    from ..shared import helper",
  ].join("\n");

  assert.deepEqual(
    scanPythonImportSpecifiers(source).map(({ form, specifier, line, column }) => ({ form, specifier, line, column })),
    [
      { form: "import", specifier: "os", line: 4, column: 1 },
      { form: "import", specifier: "pkg.util", line: 4, column: 1 },
      { form: "from", specifier: ".helper", line: 5, column: 1 },
      { form: "from", specifier: "..shared", line: 8, column: 5 },
    ],
  );
});

test("multi-language graph resolves local Python modules and packages without inventing external dependencies", async () => {
  const repository = snapshot([
    file("pkg/__init__.py", ""),
    file("pkg/util.py", "VALUE = 1\n"),
    file("pkg/sub/__init__.py", ""),
    file("pkg/sub/helper.py", "VALUE = 2\n"),
    file("pkg/sub/main.py", [
      "from .helper import VALUE as helper_value",
      "from ..util import VALUE as parent_value",
      "import pkg.util",
      "import requests",
    ].join("\n")),
  ]);

  const graph = await extractRepositoryMultiLanguageDependencyGraph(repository);
  const main = nodeByPath(graph, "pkg/sub/main.py");
  const helper = nodeByPath(graph, "pkg/sub/helper.py");
  const util = nodeByPath(graph, "pkg/util.py");
  assert.ok(main && helper && util);
  assert.ok(graph.extractors.some((extractor) => extractor.id === "python-imports"));

  const importEdges = graph.edges.filter((edge) => edge.kind === "imports" && edge.from === main.id);
  assert.equal(importEdges.length, 3);
  assert.ok(importEdges.some((edge) => edge.to === helper.id && edge.qualifier === "python:from:.helper"));
  assert.ok(importEdges.some((edge) => edge.to === util.id && edge.qualifier === "python:from:..util"));
  assert.ok(importEdges.some((edge) => edge.to === util.id && edge.qualifier === "python:import:pkg.util"));
  assert.equal(graph.nodes.some((node) => node.kind === "dependency" && node.label === "requests"), false);
});

test("Repository Audit graph pipeline includes Python relationships in blast-radius analysis", async () => {
  const repository = snapshot([
    file("pkg/__init__.py", ""),
    file("pkg/lib.py", "VALUE = 1\n"),
    file("pkg/service.py", "from .lib import VALUE\nSERVICE = VALUE\n"),
    file("pkg/route.py", "from .service import SERVICE\nROUTE = SERVICE\n"),
  ]);
  const result = await analyzeRepositoryGraph(repository);
  const graph = result.graph;
  const lib = graph.nodes.find((node) => node.kind === "file" && node.metadata?.path === "pkg/lib.py");
  const service = graph.nodes.find((node) => node.kind === "file" && node.metadata?.path === "pkg/service.py");
  const route = graph.nodes.find((node) => node.kind === "file" && node.metadata?.path === "pkg/route.py");
  assert.ok(lib && service && route);

  const index = await createSolveGraphQueryIndex(graph);
  const impact = analyzeSolveGraphImpact(index, [lib.id]);
  assert.deepEqual(impact.entries.map((entry) => entry.id), [lib.id, service.id, route.id]);
  assert.deepEqual(impact.entries.map((entry) => entry.depth), [0, 1, 2]);
  assert.equal(result.execution.status, "complete");
});

test("equivalent reordered Python snapshots produce identical canonical dependency graphs", async () => {
  const files = [
    file("pkg/__init__.py", ""),
    file("pkg/a.py", "from .b import B\nA = B\n"),
    file("pkg/b.py", "B = 'value'\n"),
  ];
  const left = await extractRepositoryMultiLanguageDependencyGraph(snapshot(files));
  const right = await extractRepositoryMultiLanguageDependencyGraph(snapshot([...files].reverse()));
  assert.equal(serializeSolveGraphDocument(left), serializeSolveGraphDocument(right));
  assert.equal(left.graphId, right.graphId);
});

test("Python import relationships honor the shared edge bound and fail closed as partial", async () => {
  const repository = snapshot([
    file("pkg/__init__.py", ""),
    file("pkg/a.py", "from .b import B\n"),
    file("pkg/b.py", "B = 1\n"),
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
