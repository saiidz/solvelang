import assert from "node:assert/strict";
import test from "node:test";
import { extractRepositoryDependencyGraph } from "../../solve-graph/core/import-extractor";
import { defaultSolveGraphScanLimits } from "../../solve-graph/core/limits";
import { createRepositoryCoverageMap } from "./coverageMapping";
import type { RepositorySnapshot } from "./inventory";

function fixture(): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "coverage.zip",
      revision: `sha256:${"1".repeat(64)}`,
      fingerprint: `sha256:${"2".repeat(64)}`,
    },
    files: [
      { path: "src/a.ts", byteSize: 24, text: "export const a = 1;\n" },
      { path: "src/b.ts", byteSize: 24, text: "export const b = 2;\n" },
      { path: "tests/a.test.ts", byteSize: 64, text: 'import { a } from "../src/a";\nvoid a;\n' },
      {
        path: "docs/guide.md",
        byteSize: 120,
        text: [
          "# Guide",
          "See [source A](../src/a.ts).",
          "See [source A again](../src/a.ts#details).",
          "Ignore [external](https://example.com/src/b.ts).",
          "Ignore [outside](../../outside.ts).",
        ].join("\n"),
      },
    ],
  };
}

test("maps direct test imports and explicit documentation links without claiming behavioral coverage", async () => {
  const input = fixture();
  const graph = await extractRepositoryDependencyGraph(input);
  const result = createRepositoryCoverageMap(input, graph);

  assert.equal(result.schema, "solvelang.repository-audit.coverage-map.v0");
  assert.equal(result.mode, "analyze-only");
  assert.equal(result.execution.status, "complete");
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
  assert.deepEqual(result.summary, {
    sourceFiles: 2,
    testFiles: 1,
    documentationFiles: 1,
    directlyTestedSourceFiles: 1,
    documentationLinkedSourceFiles: 1,
  });
  assert.deepEqual(result.testMappings, [
    { testPath: "tests/a.test.ts", targetPath: "src/a.ts", importEdgeCount: 1 },
  ]);
  assert.deepEqual(result.documentationMappings, [
    { documentPath: "docs/guide.md", targetPath: "src/a.ts", linkCount: 2, firstLine: 2 },
  ]);
  assert.deepEqual(result.sourceFilesWithoutDirectTestImport, ["src/b.ts"]);
  assert.deepEqual(result.sourceFilesWithoutDocumentationLink, ["src/b.ts"]);
});

test("keeps mapping and unmapped samples bounded and deterministic", async () => {
  const input = fixture();
  const graph = await extractRepositoryDependencyGraph(input);
  const left = createRepositoryCoverageMap(input, graph, { maxMappings: 1, maxUnmappedSamples: 1 });
  const right = createRepositoryCoverageMap(input, graph, { maxMappings: 1, maxUnmappedSamples: 1 });

  assert.deepEqual(left, right);
  assert.equal(left.execution.status, "partial");
  assert.equal(left.execution.mappingsTruncated, true);
  assert.equal(left.testMappings.length, 1);
  assert.equal(left.documentationMappings.length, 0);
  assert.deepEqual(left.sourceFilesWithoutDirectTestImport, ["src/b.ts"]);
});

test("surfaces a partial graph boundary instead of implying complete repository coverage", async () => {
  const input = fixture();
  const graph = await extractRepositoryDependencyGraph(input, {
    limits: { ...defaultSolveGraphScanLimits, maxFiles: 2 },
  });
  const result = createRepositoryCoverageMap(input, graph);

  assert.equal(graph.execution.truncated, true);
  assert.equal(result.execution.status, "partial");
  assert.equal(result.execution.graphTruncated, true);
});

test("rejects invalid bounds", async () => {
  const input = fixture();
  const graph = await extractRepositoryDependencyGraph(input);
  assert.throws(() => createRepositoryCoverageMap(input, graph, { maxMappings: 0 }), /maxMappings/);
  assert.throws(() => createRepositoryCoverageMap(input, graph, { maxUnmappedSamples: 1001 }), /maxUnmappedSamples/);
});
