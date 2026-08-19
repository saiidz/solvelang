import assert from "node:assert/strict";
import test from "node:test";
import type { RepositoryPackageScriptPathEvidenceAnalysis } from "./packageScriptPathEvidence";
import {
  createRepositoryPackageScriptPathEvidenceArtifact,
  createRepositoryPackageScriptPathEvidenceDownload,
  serializeRepositoryPackageScriptPathEvidenceArtifact,
} from "./packageScriptPathArtifact";
import { verifyRepositoryAuditIntegrity } from "./reportIntegrity";

function fixture(): RepositoryPackageScriptPathEvidenceAnalysis {
  return {
    schema: "solvelang.repository-audit.package-script-path-evidence.v0",
    mode: "analyze-only",
    graphId: "sg_fixture",
    status: "complete",
    relationships: [
      {
        evidenceId: "package-script-path:node-entrypoint:package.json:start:src/server.js",
        kind: "node-entrypoint",
        fromPath: "package.json",
        scriptName: "start",
        rawReference: "./src/server.js",
        targetPath: "src/server.js",
        targetState: "present",
        evidence: { path: "package.json", field: "scripts.start" },
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
      acceptedFiles: 8,
      packageFilesExamined: 1,
      graphTruncated: false,
    },
  };
}

test("creates deterministic integrity-covered package-script path evidence", async () => {
  const analysis = fixture();
  const first = await createRepositoryPackageScriptPathEvidenceArtifact(analysis);
  const second = await createRepositoryPackageScriptPathEvidenceArtifact(analysis);

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.package-script-path-evidence.v1");
  assert.equal(first.schemaVersion, "1.0.0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.equal(first.relationships[0]?.scriptName, "start");
  assert.equal(first.relationships[0]?.targetPath, "src/server.js");
  assert.equal(first.relationships[0]?.evidence.path, "package.json");
  assert.equal(await verifyRepositoryAuditIntegrity(first), true);
  assert.ok(serializeRepositoryPackageScriptPathEvidenceArtifact(first).endsWith("\n"));
});

test("artifact is detached from mutable analysis input and tampering breaks integrity", async () => {
  const analysis = fixture();
  const artifact = await createRepositoryPackageScriptPathEvidenceArtifact(analysis);

  analysis.relationships[0]!.targetPath = "changed-after-export";
  analysis.relationships[0]!.evidence.path = "changed-after-export";
  analysis.skipped.dynamicScript = 7;

  assert.equal(artifact.relationships[0]?.targetPath, "src/server.js");
  assert.equal(artifact.relationships[0]?.evidence.path, "package.json");
  assert.equal(artifact.skipped.dynamicScript, 0);

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
  analysis.skipped.invalidTarget = 1;

  const artifact = await createRepositoryPackageScriptPathEvidenceArtifact(analysis);

  assert.equal(artifact.status, "partial");
  assert.equal(artifact.execution.relationshipsTruncated, true);
  assert.equal(artifact.skipped.invalidTarget, 1);
  assert.equal(artifact.execution.networkAccess, false);
  assert.equal(artifact.execution.writeAccess, false);
});

test("creates a browser-ready package-script path download", async () => {
  const download = await createRepositoryPackageScriptPathEvidenceDownload(
    "My Repository.zip",
    fixture(),
  );

  assert.equal(
    download.filename,
    "My-Repository-solvelang-repository-audit-package-script-paths.json",
  );
  assert.equal(download.mediaType, "application/json;charset=utf-8");
  assert.ok(download.content.endsWith("\n"));
  assert.deepEqual(JSON.parse(download.content), download.artifact);
  assert.equal(download.artifact.mode, "analyze-only");
  assert.equal(download.artifact.execution.networkAccess, false);
  assert.equal(download.artifact.execution.writeAccess, false);
  assert.equal(await verifyRepositoryAuditIntegrity(download.artifact), true);
});
