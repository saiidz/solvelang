import assert from "node:assert/strict";
import test from "node:test";
import type { RepositoryPackageScriptPathEvidenceAnalysis } from "./packageScriptPathEvidence";
import { createRepositoryPackageScriptPathPresentation } from "./packageScriptPathPresentation";

function fixture(): RepositoryPackageScriptPathEvidenceAnalysis {
  return {
    schema: "solvelang.repository-audit.package-script-path-evidence.v0",
    mode: "analyze-only",
    graphId: "sg_fixture",
    status: "complete",
    relationships: [
      {
        evidenceId: "z",
        kind: "vite-config",
        fromPath: "packages/web/package.json",
        scriptName: "build",
        rawReference: "vite.config.ts",
        targetPath: "packages/web/vite.config.ts",
        targetState: "missing",
        evidence: { path: "packages/web/package.json", field: "scripts.build" },
      },
      {
        evidenceId: "a",
        kind: "node-entrypoint",
        fromPath: "package.json",
        scriptName: "start",
        rawReference: "./src/server.js",
        targetPath: "src/server.js",
        targetState: "present",
        evidence: { path: "package.json", field: "scripts.start" },
      },
      {
        evidenceId: "b",
        kind: "tsc-project",
        fromPath: "package.json",
        scriptName: "typecheck",
        rawReference: "tsconfig.build.json",
        targetPath: "tsconfig.build.json",
        targetState: "outside-bounded-scan",
        evidence: { path: "package.json", field: "scripts.typecheck" },
      },
    ],
    skipped: {
      missingText: 0,
      oversizedPackageText: 0,
      oversizedScript: 0,
      invalidJson: 0,
      dynamicScript: 0,
      invalidTarget: 0,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships: 250,
      maxPackageTextBytes: 1024 * 1024,
      maxScriptTextBytes: 4 * 1024,
      relationshipsTruncated: false,
      acceptedFiles: 12,
      packageFilesExamined: 2,
      graphTruncated: false,
    },
  };
}

test("creates deterministic bounded package-script path presentation rows", () => {
  const analysis = fixture();
  const first = createRepositoryPackageScriptPathPresentation(analysis);
  const second = createRepositoryPackageScriptPathPresentation(analysis);

  assert.deepEqual(first, second);
  assert.deepEqual(first.rows.map((row) => row.evidenceId), ["a", "b", "z"]);
  assert.deepEqual(first.summary, {
    relationships: 3,
    presentTargets: 1,
    outsideBoundedScanTargets: 1,
    missingTargets: 1,
    rowsShown: 3,
    rowsHidden: 0,
    skippedMissingText: 0,
    skippedOversizedPackageText: 0,
    skippedOversizedScripts: 0,
    skippedInvalidJson: 0,
    skippedDynamicScripts: 0,
    skippedInvalidTargets: 0,
  });
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.equal(first.execution.sourcePartial, false);
});

test("presentation rows are detached from mutable analyzer evidence", () => {
  const analysis = fixture();
  const presentation = createRepositoryPackageScriptPathPresentation(analysis);

  analysis.relationships[0]!.targetPath = "changed-after-presentation";
  analysis.relationships[0]!.evidence.path = "changed-after-presentation";

  assert.equal(presentation.rows[2]?.targetPath, "packages/web/vite.config.ts");
  assert.equal(presentation.rows[2]?.evidence.path, "packages/web/package.json");
});

test("preserves analyzer partial truth and explains skipped evidence", () => {
  const analysis = fixture();
  analysis.status = "partial";
  analysis.execution.graphTruncated = true;
  analysis.execution.relationshipsTruncated = true;
  analysis.skipped.missingText = 1;
  analysis.skipped.oversizedPackageText = 2;
  analysis.skipped.oversizedScript = 3;
  analysis.skipped.invalidJson = 4;
  analysis.skipped.dynamicScript = 5;
  analysis.skipped.invalidTarget = 6;

  const presentation = createRepositoryPackageScriptPathPresentation(analysis);

  assert.equal(presentation.execution.sourcePartial, true);
  assert.ok(presentation.notices.some((notice) => notice.includes("underlying repository graph is partial")));
  assert.ok(presentation.notices.some((notice) => notice.includes("relationship limit")));
  assert.ok(presentation.notices.some((notice) => notice.includes("lacked readable text")));
  assert.ok(presentation.notices.some((notice) => notice.includes("package-text limit")));
  assert.ok(presentation.notices.some((notice) => notice.includes("script-text limit")));
  assert.ok(presentation.notices.some((notice) => notice.includes("invalid JSON")));
  assert.ok(presentation.notices.some((notice) => notice.includes("dynamic package script")));
  assert.ok(presentation.notices.some((notice) => notice.includes("non-local or ambiguous")));
});

test("row bounds are explicit and invalid bounds fail closed", () => {
  const presentation = createRepositoryPackageScriptPathPresentation(fixture(), { maxRows: 1 });
  assert.equal(presentation.rows.length, 1);
  assert.equal(presentation.summary.rowsHidden, 2);
  assert.equal(presentation.execution.rowsTruncated, true);
  assert.ok(presentation.notices.some((notice) => notice.includes("first bounded subset")));

  assert.throws(
    () => createRepositoryPackageScriptPathPresentation(fixture(), { maxRows: 0 }),
    /maxRows/,
  );
  assert.throws(
    () => createRepositoryPackageScriptPathPresentation(fixture(), { maxRows: 1_001 }),
    /maxRows/,
  );
});
