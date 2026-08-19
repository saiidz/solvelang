import assert from "node:assert/strict";
import test from "node:test";
import { defaultSolveGraphScanLimits } from "../../solve-graph/core/limits";
import { analyzeRepositorySnapshot } from "./analysisPipeline";
import type { RepositorySnapshot } from "./inventory";

const secret = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
const hmacKey = new Uint8Array(32).fill(7);

function fixture(files?: RepositorySnapshot["files"]): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "analysis.zip",
      revision: `sha256:${"1".repeat(64)}`,
      fingerprint: `sha256:${"2".repeat(64)}`,
    },
    files: files ?? [
      {
        path: "src/store.ts",
        byteSize: 24,
        sha256: "3".repeat(64),
        text: "export const store = 1;\n",
      },
      {
        path: "src/api.ts",
        byteSize: 100,
        sha256: "4".repeat(64),
        text: `import { store } from "./store";\nconst token = "${secret}";\nexport { store };\n`,
      },
      {
        path: ".env.example",
        byteSize: 25,
        sha256: "5".repeat(64),
        text: "API_KEY=your_key_example\n",
      },
    ],
  };
}

test("composes bounded repository evidence stages and redacted secret warnings without exposing secret values", async () => {
  const result = await analyzeRepositorySnapshot(fixture(), { secretHmacKey: hmacKey });
  assert.equal(result.schema, "solvelang.repository-audit.analysis.v0");
  assert.equal(result.mode, "analyze-only");
  assert.equal(result.execution.status, "complete");
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
  assert.equal(result.graph.graph.source.private, true);
  assert.ok(result.graph.graph.edges.some((edge) => edge.kind === "imports"));
  assert.equal(result.dependencyConsistency.schema, "solvelang.repository-audit.dependency-consistency.v0");
  assert.equal(result.coverageMap.schema, "solvelang.repository-audit.coverage-map.v0");
  assert.equal(result.deadCodeCandidates.schema, "solvelang.repository-audit.dead-code-candidates.v0");
  assert.equal(result.configurationReferences.schema, "solvelang.repository-audit.configuration-references.v0");
  assert.equal(result.workflowPathEvidence.schema, "solvelang.repository-audit.workflow-path-evidence.v0");
  assert.equal(result.affectedValidation, undefined);
  assert.equal(result.execution.affectedValidationStatus, undefined);
  assert.equal(result.execution.dependencyConsistencyStatus, "complete");
  assert.equal(result.execution.coverageMapStatus, "complete");
  assert.equal(result.execution.deadCodeCandidateStatus, "complete");
  assert.equal(result.execution.configurationReferenceStatus, "complete");
  assert.equal(result.execution.workflowPathEvidenceStatus, "complete");
  assert.equal(result.execution.dependencyFilesScanned, 2);
  assert.equal(result.execution.undeclaredDependencyFindings, 0);
  assert.equal(result.execution.directTestMappings, 0);
  assert.equal(result.execution.documentationMappings, 0);
  assert.equal(result.execution.deadCodeCandidateCount, 1);
  assert.equal(result.execution.configurationReferenceCount, 0);
  assert.equal(result.execution.workflowPathReferenceCount, 0);
  assert.equal(result.execution.secretFilesScanned, 3);
  assert.equal(result.secretWarnings.length, 1);
  assert.equal(result.execution.redactedSecretMatches, 1);
  assert.equal(result.secretWarnings[0].redacted, true);
  assert.match(result.secretWarnings[0].fingerprint, /^hmac-sha256:[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("surfaces dependency, test, documentation, configuration, workflow, and affected-validation evidence in one bounded analysis", async () => {
  const workflow = [
    "jobs:",
    "  test:",
    "    defaults:",
    "      run:",
    "        working-directory: src",
  ].join("\n");
  const result = await analyzeRepositorySnapshot(fixture([
    { path: "package.json", byteSize: 80, text: JSON.stringify({ main: "./src/app.ts" }) },
    { path: "src/lib.ts", byteSize: 24, text: "export const lib = 1;\n" },
    { path: "src/app.ts", byteSize: 72, text: 'import helper from "missing-package";\nimport { lib } from "./lib";\nvoid helper; void lib;\n' },
    { path: "tests/app.test.ts", byteSize: 56, text: 'import "../src/app";\n' },
    { path: "docs/guide.md", byteSize: 48, text: "See [app](../src/app.ts).\n" },
    { path: ".github/workflows/ci.yml", byteSize: workflow.length, text: workflow },
  ]), {
    affectedValidation: { changedPaths: ["src/app.ts"] },
  });

  assert.equal(result.execution.status, "complete");
  assert.equal(result.execution.undeclaredDependencyFindings, 1);
  assert.equal(result.dependencyConsistency.undeclaredImports[0].packageName, "missing-package");
  assert.equal(result.execution.directTestMappings, 1);
  assert.equal(result.execution.documentationMappings, 1);
  assert.equal(result.execution.configurationReferenceCount, 1);
  assert.equal(result.configurationReferences.references[0].targetPath, "src/app.ts");
  assert.equal(result.execution.workflowPathReferenceCount, 1);
  assert.equal(result.workflowPathEvidence.references[0].targetPath, "src");
  assert.equal(result.execution.affectedValidationStatus, "complete");
  assert.equal(result.execution.affectedTestFiles, 1);
  assert.equal(result.execution.affectedWorkflowFiles, 1);
  assert.ok(result.affectedValidation);
  assert.deepEqual(result.affectedValidation.entries[0].tests.map((item) => item.testPath), ["tests/app.test.ts"]);
  assert.deepEqual(result.affectedValidation.entries[0].workflows.map((item) => item.workflowPath), [".github/workflows/ci.yml"]);
});

test("affected-validation incompleteness participates in overall partial truth", async () => {
  const result = await analyzeRepositorySnapshot(fixture(), {
    affectedValidation: { changedPaths: ["missing.ts"] },
  });
  assert.equal(result.execution.status, "partial");
  assert.equal(result.execution.truncated, false);
  assert.equal(result.execution.affectedValidationStatus, "partial");
  assert.equal(result.affectedValidation?.summary.unresolvedChangedPaths, 1);
});

test("a supplied HMAC key makes redacted warning fingerprints reproducible without storing the secret", async () => {
  const left = await analyzeRepositorySnapshot(fixture(), { secretHmacKey: hmacKey });
  const right = await analyzeRepositorySnapshot(fixture(), { secretHmacKey: hmacKey });
  assert.deepEqual(left.secretWarnings, right.secretWarnings);
  assert.ok(!left.secretWarnings[0].fingerprint.includes(secret));
});

test("partial inventory or graph work is surfaced as partial and secondary scanners obey graph bounds", async () => {
  const result = await analyzeRepositorySnapshot(fixture(), {
    inventoryLimits: { maxFiles: 2 },
    graph: {
      graphLimits: { ...defaultSolveGraphScanLimits, maxFiles: 1 },
      intelligence: { maxHotspots: 10, maxImpactDepth: 2, maxImpactResults: 20 },
    },
    secretHmacKey: hmacKey,
  });
  assert.equal(result.execution.status, "partial");
  assert.equal(result.execution.truncated, true);
  assert.ok(result.execution.inventoryTruncationReasons.includes("file-count"));
  assert.ok(result.execution.graphTruncationReasons.includes("file-count"));
  assert.equal(result.dependencyConsistency.execution.findingsSuppressed, true);
  assert.equal(result.coverageMap.execution.status, "partial");
  assert.equal(result.deadCodeCandidates.status, "suppressed");
  assert.equal(result.configurationReferences.status, "partial");
  assert.equal(result.workflowPathEvidence.status, "partial");
  assert.equal(result.execution.secretFilesScanned, 1);
  assert.equal(result.execution.redactedSecretMatches, 0);
  assert.deepEqual(result.secretWarnings, []);
});

test("unsafe repository paths fail closed before redacted secret analysis", async () => {
  await assert.rejects(
    analyzeRepositorySnapshot(fixture([{ path: "../outside.ts", byteSize: 1, text: secret }]), { secretHmacKey: hmacKey }),
    /cannot traverse outside|relative/,
  );
});
