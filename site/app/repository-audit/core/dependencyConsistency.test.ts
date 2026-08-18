import assert from "node:assert/strict";
import test from "node:test";
import { extractRepositoryDependencyGraph } from "../../solve-graph/core/import-extractor";
import { defaultSolveGraphScanLimits } from "../../solve-graph/core/limits";
import { analyzeRepositoryDependencyConsistency } from "./dependencyConsistency";
import type { RepositorySnapshot } from "./inventory";

function snapshot(files: RepositorySnapshot["files"]): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "dependency-consistency.zip",
      revision: `sha256:${"1".repeat(64)}`,
      fingerprint: `sha256:${"2".repeat(64)}`,
    },
    files,
  };
}

test("reports bounded undeclared package candidates while honoring declarations, workspace names, aliases, and Node builtins", async () => {
  const input = snapshot([
    {
      path: "package.json",
      byteSize: 120,
      text: JSON.stringify({ name: "@acme/app", dependencies: { react: "1.0.0" } }),
    },
    {
      path: "tsconfig.json",
      byteSize: 100,
      text: JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    },
    {
      path: "src/app.ts",
      byteSize: 240,
      text: [
        'import React from "react";',
        'import self from "@acme/app/internal";',
        'import localAlias from "@/local";',
        'import missing from "@missing/pkg";',
        'import helper from "left-pad/subpath";',
        'import fs from "fs";',
        'import nodeFs from "node:fs";',
        "void React; void self; void localAlias; void missing; void helper; void fs; void nodeFs;",
      ].join("\n"),
    },
  ]);
  const graph = await extractRepositoryDependencyGraph(input);
  const result = analyzeRepositoryDependencyConsistency(input, graph);

  assert.equal(result.schema, "solvelang.repository-audit.dependency-consistency.v0");
  assert.equal(result.mode, "analyze-only");
  assert.equal(result.execution.status, "complete");
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
  assert.deepEqual(result.declaredPackages, ["react"]);
  assert.deepEqual(result.workspacePackages, ["@acme/app"]);
  assert.deepEqual(result.importedPackages, ["@acme/app", "@missing/pkg", "left-pad", "react"]);
  assert.deepEqual(result.undeclaredImports.map((finding) => [finding.packageName, finding.confidence]), [
    ["@missing/pkg", "high"],
    ["left-pad", "medium"],
  ]);
  assert.equal(result.undeclaredImports[0].evidence[0].path, "src/app.ts");
  assert.equal(result.undeclaredImports[0].occurrenceCount, 1);
});

test("suppresses findings when a manifest or path-alias config cannot be parsed", async () => {
  const input = snapshot([
    { path: "package.json", byteSize: 10, text: "{broken" },
    { path: "src/app.ts", byteSize: 40, text: 'import missing from "missing-package";' },
  ]);
  const graph = await extractRepositoryDependencyGraph(input);
  const result = analyzeRepositoryDependencyConsistency(input, graph);

  assert.equal(result.execution.status, "partial");
  assert.equal(result.execution.parseFailures, 1);
  assert.equal(result.execution.findingsSuppressed, true);
  assert.deepEqual(result.undeclaredImports, []);
});

test("suppresses findings when the bounded graph scan is partial", async () => {
  const input = snapshot([
    { path: "package.json", byteSize: 20, text: "{}" },
    { path: "src/app.ts", byteSize: 40, text: 'import missing from "missing-package";' },
  ]);
  const graph = await extractRepositoryDependencyGraph(input, {
    limits: { ...defaultSolveGraphScanLimits, maxFiles: 1 },
  });
  const result = analyzeRepositoryDependencyConsistency(input, graph);

  assert.equal(graph.execution.truncated, true);
  assert.equal(result.execution.status, "partial");
  assert.equal(result.execution.findingsSuppressed, true);
  assert.deepEqual(result.undeclaredImports, []);
});

test("caps findings and evidence deterministically", async () => {
  const input = snapshot([
    { path: "package.json", byteSize: 20, text: "{}" },
    {
      path: "src/app.ts",
      byteSize: 120,
      text: [
        'import a from "alpha";',
        'import a2 from "alpha";',
        'import b from "beta";',
      ].join("\n"),
    },
  ]);
  const graph = await extractRepositoryDependencyGraph(input);
  const left = analyzeRepositoryDependencyConsistency(input, graph, { maxFindings: 1, maxEvidencePerFinding: 1 });
  const right = analyzeRepositoryDependencyConsistency(input, graph, { maxFindings: 1, maxEvidencePerFinding: 1 });

  assert.deepEqual(left, right);
  assert.equal(left.execution.status, "partial");
  assert.equal(left.execution.findingsTruncated, true);
  assert.equal(left.undeclaredImports.length, 1);
  assert.equal(left.undeclaredImports[0].packageName, "alpha");
  assert.equal(left.undeclaredImports[0].occurrenceCount, 2);
  assert.equal(left.undeclaredImports[0].evidence.length, 1);
  assert.equal(left.undeclaredImports[0].evidenceTruncated, true);
});
