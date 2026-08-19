import assert from "node:assert/strict";
import test from "node:test";

import type { RepositoryAngularTargetConfigEvidenceAnalysis } from "./angularTargetConfigEvidence";
import { createRepositoryAngularTargetConfigPresentation } from "./angularTargetConfigPresentation";

function fixture(): RepositoryAngularTargetConfigEvidenceAnalysis {
  return {
    schema: "solvelang.repository-audit.angular-target-config-evidence.v0",
    mode: "analyze-only",
    graphId: "sg_angular_target_config_presentation",
    status: "complete",
    relationships: [
      {
        evidenceId: "angular-target-tsconfig:packages/admin/angular.json:projects.admin.test.options.tsConfig:packages/admin/tsconfig.spec.json",
        kind: "angular-target-tsconfig",
        framework: "angular",
        fromPath: "packages/admin/angular.json",
        project: "admin",
        target: "test",
        rawReference: "tsconfig.spec.json",
        targetPath: "packages/admin/tsconfig.spec.json",
        targetState: "outside-bounded-scan",
        evidence: { path: "packages/admin/angular.json", field: "projects.admin.test.options.tsConfig" },
      },
      {
        evidenceId: "angular-target-tsconfig:angular.json:projects.app.test.options.tsConfig:tsconfig.spec.json",
        kind: "angular-target-tsconfig",
        framework: "angular",
        fromPath: "angular.json",
        project: "app",
        target: "test",
        rawReference: "tsconfig.spec.json",
        targetPath: "tsconfig.spec.json",
        targetState: "missing",
        evidence: { path: "angular.json", field: "projects.app.test.options.tsConfig" },
      },
      {
        evidenceId: "angular-target-tsconfig:angular.json:projects.app.build.options.tsConfig:tsconfig.app.json",
        kind: "angular-target-tsconfig",
        framework: "angular",
        fromPath: "angular.json",
        project: "app",
        target: "build",
        rawReference: "tsconfig.app.json",
        targetPath: "tsconfig.app.json",
        targetState: "present",
        evidence: { path: "angular.json", field: "projects.app.build.options.tsConfig" },
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
      angularConfigsExamined: 2,
      graphTruncated: false,
    },
  };
}

test("creates deterministic bounded Angular target config presentation without adding capabilities", () => {
  const analysis = fixture();
  const first = createRepositoryAngularTargetConfigPresentation(analysis);
  const second = createRepositoryAngularTargetConfigPresentation({
    ...analysis,
    relationships: [...analysis.relationships].reverse(),
  });

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.angular-target-config-presentation.v0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.graphId, "sg_angular_target_config_presentation");
  assert.equal(first.summary.relationships, 3);
  assert.equal(first.summary.presentTargets, 1);
  assert.equal(first.summary.outsideBoundedScanTargets, 1);
  assert.equal(first.summary.missingTargets, 1);
  assert.equal(first.summary.rowsShown, 3);
  assert.equal(first.summary.rowsHidden, 0);
  assert.equal(first.rows[0]?.project, "app");
  assert.equal(first.rows[0]?.target, "build");
  assert.equal(first.rows[0]?.targetPath, "tsconfig.app.json");
  assert.deepEqual(first.rows[0]?.evidence, {
    path: "angular.json",
    field: "projects.app.build.options.tsConfig",
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

  const presentation = createRepositoryAngularTargetConfigPresentation(analysis, { maxRows: 1 });

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
  const presentation = createRepositoryAngularTargetConfigPresentation(analysis);

  analysis.relationships[0]!.targetPath = "changed-after-presentation";
  analysis.relationships[1]!.evidence.path = "changed-after-presentation";

  assert.equal(presentation.rows.some(({ targetPath }) => targetPath === "changed-after-presentation"), false);
  assert.equal(presentation.rows.some(({ evidence }) => evidence.path === "changed-after-presentation"), false);
});

test("rejects invalid Angular target config presentation bounds", () => {
  assert.throws(
    () => createRepositoryAngularTargetConfigPresentation(fixture(), { maxRows: 0 }),
    /maxRows must be an integer from 1 through 1000/,
  );
  assert.throws(
    () => createRepositoryAngularTargetConfigPresentation(fixture(), { maxRows: 1_001 }),
    /maxRows must be an integer from 1 through 1000/,
  );
});
