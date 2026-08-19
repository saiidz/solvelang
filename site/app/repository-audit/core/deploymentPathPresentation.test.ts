import assert from "node:assert/strict";
import test from "node:test";

import type { RepositoryDeploymentPathEvidenceAnalysis } from "./deploymentPathEvidence";
import { createRepositoryDeploymentPathPresentation } from "./deploymentPathPresentation";

function fixture(): RepositoryDeploymentPathEvidenceAnalysis {
  return {
    schema: "solvelang.repository-audit.deployment-path-evidence.v0",
    mode: "analyze-only",
    graphId: "sg_deployment_presentation",
    status: "complete",
    relationships: [
      {
        evidenceId: "deployment-path:vercel-output-directory:vercel.json:dist",
        kind: "vercel-output-directory",
        fromPath: "vercel.json",
        rawReference: "dist",
        targetPath: "dist",
        targetType: "directory",
        targetState: "outside-bounded-scan",
        evidence: { path: "vercel.json", field: "outputDirectory" },
      },
      {
        evidenceId: "deployment-path:docker-copy-source:Dockerfile:2:src/app.ts",
        kind: "docker-copy-source",
        fromPath: "Dockerfile",
        rawReference: "src/app.ts",
        targetPath: "src/app.ts",
        targetType: "file",
        targetState: "present",
        evidence: { path: "Dockerfile", line: 2 },
      },
      {
        evidenceId: "deployment-path:sam-code-uri:template.yaml:services/missing",
        kind: "sam-code-uri",
        fromPath: "template.yaml",
        rawReference: "services/missing",
        targetPath: "services/missing",
        targetType: "directory",
        targetState: "missing",
        evidence: { path: "template.yaml", line: 8, field: "CodeUri" },
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
      acceptedFiles: 14,
      deploymentFilesExamined: 3,
      graphTruncated: false,
    },
  };
}

test("creates deterministic bounded deployment path presentation without adding capabilities", () => {
  const analysis = fixture();
  const first = createRepositoryDeploymentPathPresentation(analysis);
  const second = createRepositoryDeploymentPathPresentation({
    ...analysis,
    relationships: [...analysis.relationships].reverse(),
  });

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.deployment-path-presentation.v0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.graphId, "sg_deployment_presentation");
  assert.equal(first.summary.relationships, 3);
  assert.equal(first.summary.presentTargets, 1);
  assert.equal(first.summary.outsideBoundedScanTargets, 1);
  assert.equal(first.summary.missingTargets, 1);
  assert.equal(first.summary.rowsShown, 3);
  assert.equal(first.summary.rowsHidden, 0);
  assert.equal(first.rows[0]?.fromPath, "Dockerfile");
  assert.equal(first.rows[0]?.targetPath, "src/app.ts");
  assert.deepEqual(first.rows[0]?.evidence, { path: "Dockerfile", line: 2 });
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.deepEqual(first.notices, []);
});

test("preserves partial, skipped-reference, and truncation truth in concise notices", () => {
  const analysis = fixture();
  analysis.status = "partial";
  analysis.execution.graphTruncated = true;
  analysis.execution.relationshipsTruncated = true;
  analysis.skipped.dynamicReference = 2;

  const presentation = createRepositoryDeploymentPathPresentation(analysis, { maxRows: 1 });

  assert.equal(presentation.status, "partial");
  assert.equal(presentation.summary.rowsShown, 1);
  assert.equal(presentation.summary.rowsHidden, 2);
  assert.equal(presentation.summary.skippedDynamicReferences, 2);
  assert.equal(presentation.execution.sourcePartial, true);
  assert.equal(presentation.execution.rowsTruncated, true);
  assert.equal(presentation.notices.length, 4);
  assert.match(presentation.notices[0] ?? "", /repository graph is partial/i);
  assert.match(presentation.notices[1] ?? "", /relationship limit/i);
  assert.match(presentation.notices[2] ?? "", /skipped rather than guessed/i);
  assert.match(presentation.notices[3] ?? "", /first bounded subset/i);
});

test("presentation rows detach evidence objects from mutable analyzer input", () => {
  const analysis = fixture();
  const presentation = createRepositoryDeploymentPathPresentation(analysis);

  analysis.relationships[0]!.targetPath = "changed-after-presentation";
  analysis.relationships[1]!.evidence.path = "changed-after-presentation";

  assert.equal(presentation.rows.some(({ targetPath }) => targetPath === "changed-after-presentation"), false);
  assert.equal(presentation.rows.some(({ evidence }) => evidence.path === "changed-after-presentation"), false);
});

test("rejects invalid deployment path presentation bounds", () => {
  assert.throws(
    () => createRepositoryDeploymentPathPresentation(fixture(), { maxRows: 0 }),
    /maxRows must be an integer from 1 through 1000/,
  );
  assert.throws(
    () => createRepositoryDeploymentPathPresentation(fixture(), { maxRows: 1_001 }),
    /maxRows must be an integer from 1 through 1000/,
  );
});
