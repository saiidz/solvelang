import assert from "node:assert/strict";
import test from "node:test";
import type { RepositoryFrameworkPathEvidenceAnalysis } from "./frameworkPathEvidence";
import {
  createRepositoryFrameworkPathEvidenceArtifact,
  createRepositoryFrameworkPathEvidenceDownload,
  serializeRepositoryFrameworkPathEvidenceArtifact,
} from "./frameworkPathArtifact";
import { verifyRepositoryAuditIntegrity } from "./reportIntegrity";

function fixture(): RepositoryFrameworkPathEvidenceAnalysis {
  return {
    schema: "solvelang.repository-audit.framework-path-evidence.v0",
    mode: "analyze-only",
    graphId: "sg_fixture",
    status: "complete",
    relationships: [
      {
        evidenceId: "framework-path:angular-source-root:angular.json:projects.web.sourceRoot:apps/web/src",
        kind: "angular-source-root",
        framework: "angular",
        fromPath: "angular.json",
        rawReference: "apps/web/src",
        targetPath: "apps/web/src",
        targetType: "directory",
        targetState: "present",
        evidence: { path: "angular.json", field: "projects.web.sourceRoot" },
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
      frameworkFilesExamined: 1,
      graphTruncated: false,
    },
  };
}

test("creates deterministic integrity-covered framework path evidence", async () => {
  const analysis = fixture();
  const first = await createRepositoryFrameworkPathEvidenceArtifact(analysis);
  const second = await createRepositoryFrameworkPathEvidenceArtifact(analysis);

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.framework-path-evidence.v1");
  assert.equal(first.schemaVersion, "1.0.0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.equal(first.relationships[0]?.framework, "angular");
  assert.equal(first.relationships[0]?.evidence.path, "angular.json");
  assert.equal(await verifyRepositoryAuditIntegrity(first), true);
  assert.ok(serializeRepositoryFrameworkPathEvidenceArtifact(first).endsWith("\n"));
});

test("artifact is detached from mutable analysis input and tampering breaks integrity", async () => {
  const analysis = fixture();
  const artifact = await createRepositoryFrameworkPathEvidenceArtifact(analysis);

  analysis.relationships[0]!.targetPath = "changed-after-export";
  analysis.relationships[0]!.evidence.path = "changed-after-export";
  analysis.skipped.dynamicReference = 9;

  assert.equal(artifact.relationships[0]?.targetPath, "apps/web/src");
  assert.equal(artifact.relationships[0]?.evidence.path, "angular.json");
  assert.equal(artifact.skipped.dynamicReference, 0);

  const tampered = {
    ...artifact,
    relationships: artifact.relationships.map((relationship, index) => index === 0
      ? { ...relationship, targetState: "missing" as const }
      : relationship),
  };
  assert.equal(await verifyRepositoryAuditIntegrity(tampered), false);
});

test("preserves explicit partial and truncation truth without adding capabilities", async () => {
  const analysis = fixture();
  analysis.status = "partial";
  analysis.execution.relationshipsTruncated = true;
  analysis.skipped.dynamicReference = 1;

  const artifact = await createRepositoryFrameworkPathEvidenceArtifact(analysis);

  assert.equal(artifact.status, "partial");
  assert.equal(artifact.execution.relationshipsTruncated, true);
  assert.equal(artifact.skipped.dynamicReference, 1);
  assert.equal(artifact.execution.networkAccess, false);
  assert.equal(artifact.execution.writeAccess, false);
});

test("creates a browser-ready framework evidence download without changing the analyzer contract", async () => {
  const download = await createRepositoryFrameworkPathEvidenceDownload(
    "My Repository.zip",
    fixture(),
  );

  assert.equal(
    download.filename,
    "My-Repository-solvelang-repository-audit-framework-paths.json",
  );
  assert.equal(download.mediaType, "application/json;charset=utf-8");
  assert.ok(download.content.endsWith("\n"));
  assert.deepEqual(JSON.parse(download.content), download.artifact);
  assert.equal(download.artifact.schema, "solvelang.repository-audit.framework-path-evidence.v1");
  assert.equal(download.artifact.schemaVersion, "1.0.0");
  assert.equal(download.artifact.mode, "analyze-only");
  assert.equal(download.artifact.execution.networkAccess, false);
  assert.equal(download.artifact.execution.writeAccess, false);
  assert.equal(await verifyRepositoryAuditIntegrity(download.artifact), true);
});
