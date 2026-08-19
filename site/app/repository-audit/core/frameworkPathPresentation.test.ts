import assert from "node:assert/strict";
import test from "node:test";

import type { RepositoryFrameworkPathEvidenceAnalysis } from "./frameworkPathEvidence";
import { createRepositoryFrameworkPathPresentation } from "./frameworkPathPresentation";

function fixture(): RepositoryFrameworkPathEvidenceAnalysis {
  return {
    schema: "solvelang.repository-audit.framework-path-evidence.v0",
    mode: "analyze-only",
    graphId: "sg_framework_presentation",
    status: "complete",
    relationships: [
      {
        evidenceId: "framework-path:nest-source-root:nest-cli.json:sourceRoot:apps/api/src",
        kind: "nest-source-root",
        framework: "nest",
        fromPath: "nest-cli.json",
        rawReference: "apps/api/src",
        targetPath: "apps/api/src",
        targetType: "directory",
        targetState: "outside-bounded-scan",
        evidence: { path: "nest-cli.json", field: "sourceRoot" },
      },
      {
        evidenceId: "framework-path:angular-build-entrypoint:angular.json:projects.app.build.options.main:src/missing.ts",
        kind: "angular-build-entrypoint",
        framework: "angular",
        fromPath: "angular.json",
        rawReference: "src/missing.ts",
        targetPath: "src/missing.ts",
        targetType: "file",
        targetState: "missing",
        evidence: { path: "angular.json", field: "projects.app.build.options.main" },
      },
      {
        evidenceId: "framework-path:angular-source-root:angular.json:projects.app.sourceRoot:src",
        kind: "angular-source-root",
        framework: "angular",
        fromPath: "angular.json",
        rawReference: "src",
        targetPath: "src",
        targetType: "directory",
        targetState: "present",
        evidence: { path: "angular.json", field: "projects.app.sourceRoot" },
      },
    ],
    skipped: {
      missingText: 0,
      oversizedText: 0,
      invalidJson: 0,
      dynamicReference: 0,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships: 250,
      maxConfigTextBytes: 1024 * 1024,
      relationshipsTruncated: false,
      acceptedFiles: 12,
      frameworkFilesExamined: 2,
      graphTruncated: false,
    },
  };
}

test("creates deterministic bounded framework path presentation without adding capabilities", () => {
  const analysis = fixture();
  const first = createRepositoryFrameworkPathPresentation(analysis);
  const second = createRepositoryFrameworkPathPresentation({
    ...analysis,
    relationships: [...analysis.relationships].reverse(),
  });

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.framework-path-presentation.v0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.graphId, "sg_framework_presentation");
  assert.equal(first.summary.relationships, 3);
  assert.equal(first.summary.angularRelationships, 2);
  assert.equal(first.summary.nestRelationships, 1);
  assert.equal(first.summary.presentTargets, 1);
  assert.equal(first.summary.outsideBoundedScanTargets, 1);
  assert.equal(first.summary.missingTargets, 1);
  assert.equal(first.summary.rowsShown, 3);
  assert.equal(first.summary.rowsHidden, 0);
  assert.equal(first.rows[0]?.framework, "angular");
  assert.equal(first.rows[0]?.targetPath, "src/missing.ts");
  assert.deepEqual(first.rows[0]?.evidence, {
    path: "angular.json",
    field: "projects.app.build.options.main",
  });
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.deepEqual(first.notices, []);
});

test("preserves partial, skipped-evidence, and truncation truth in concise notices", () => {
  const analysis = fixture();
  analysis.status = "partial";
  analysis.execution.graphTruncated = true;
  analysis.execution.relationshipsTruncated = true;
  analysis.skipped.missingText = 1;
  analysis.skipped.oversizedText = 1;
  analysis.skipped.invalidJson = 1;
  analysis.skipped.dynamicReference = 2;

  const presentation = createRepositoryFrameworkPathPresentation(analysis, { maxRows: 1 });

  assert.equal(presentation.status, "partial");
  assert.equal(presentation.summary.rowsShown, 1);
  assert.equal(presentation.summary.rowsHidden, 2);
  assert.equal(presentation.summary.skippedMissingText, 1);
  assert.equal(presentation.summary.skippedOversizedText, 1);
  assert.equal(presentation.summary.skippedInvalidJson, 1);
  assert.equal(presentation.summary.skippedDynamicReferences, 2);
  assert.equal(presentation.execution.sourcePartial, true);
  assert.equal(presentation.execution.rowsTruncated, true);
  assert.equal(presentation.notices.length, 7);
  assert.match(presentation.notices[0] ?? "", /repository graph is partial/i);
  assert.match(presentation.notices[1] ?? "", /relationship limit/i);
  assert.match(presentation.notices[2] ?? "", /lacked readable text/i);
  assert.match(presentation.notices[3] ?? "", /configured text limit/i);
  assert.match(presentation.notices[4] ?? "", /invalid JSON/i);
  assert.match(presentation.notices[5] ?? "", /skipped rather than guessed/i);
  assert.match(presentation.notices[6] ?? "", /first bounded subset/i);
});

test("presentation rows detach evidence objects from mutable analyzer input", () => {
  const analysis = fixture();
  const presentation = createRepositoryFrameworkPathPresentation(analysis);

  analysis.relationships[0]!.targetPath = "changed-after-presentation";
  analysis.relationships[1]!.evidence.path = "changed-after-presentation";

  assert.equal(presentation.rows.some(({ targetPath }) => targetPath === "changed-after-presentation"), false);
  assert.equal(presentation.rows.some(({ evidence }) => evidence.path === "changed-after-presentation"), false);
});

test("rejects invalid framework path presentation bounds", () => {
  assert.throws(
    () => createRepositoryFrameworkPathPresentation(fixture(), { maxRows: 0 }),
    /maxRows must be an integer from 1 through 1000/,
  );
  assert.throws(
    () => createRepositoryFrameworkPathPresentation(fixture(), { maxRows: 1_001 }),
    /maxRows must be an integer from 1 through 1000/,
  );
});
