import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "./inventory";
import {
  createDockerComposeRelationshipSnapshotArtifact,
  createDockerComposeRelationshipSnapshotDownload,
  serializeDockerComposeRelationshipSnapshotArtifact,
} from "./dockerComposeRelationshipSnapshotArtifact";
import { analyzeDockerComposeRelationshipSnapshot } from "./dockerComposeRelationshipSnapshotEvidence";
import { verifyRepositoryAuditIntegrity } from "./reportIntegrity";

function snapshot(files: RepositorySnapshot["files"]): RepositorySnapshot {
  return {
    source: {
      kind: "github",
      displayName: "example/repository",
      revision: "abc123",
      fingerprint: "sha256:example",
    },
    files,
  };
}

function completeEvidence() {
  return analyzeDockerComposeRelationshipSnapshot(
    snapshot([{
      path: "compose.yml",
      byteSize: 92,
      text: "services:\n  web:\n    depends_on:\n      - db\n  db:\n    image: postgres:17\n",
    }]),
  );
}

test("creates deterministic integrity-covered Docker Compose relationship evidence", async () => {
  const evidence = completeEvidence();
  const first = await createDockerComposeRelationshipSnapshotArtifact(evidence);
  const second = await createDockerComposeRelationshipSnapshotArtifact(evidence);

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.docker-compose-relationship-snapshot.v1");
  assert.equal(first.schemaVersion, "1.0.0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.status, "complete");
  assert.equal(first.files[0]?.path, "compose.yml");
  assert.equal(first.files[0]?.evidence.relationships[0]?.relationshipId, "docker-compose:depends-on:web:db");
  assert.equal(first.execution.composeEvaluation, false);
  assert.equal(first.execution.containerStart, false);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.equal(await verifyRepositoryAuditIntegrity(first), true);
  assert.ok(serializeDockerComposeRelationshipSnapshotArtifact(first).endsWith("\n"));
});

test("artifact is detached from mutable relationship evidence and tampering breaks integrity", async () => {
  const evidence = completeEvidence();
  const artifact = await createDockerComposeRelationshipSnapshotArtifact(evidence);

  evidence.files[0]!.path = "changed.yml";
  evidence.files[0]!.evidence.services[0] = "changed";
  evidence.files[0]!.evidence.relationships[0]!.toService = "changed";
  evidence.files[0]!.evidence.relationships[0]!.evidence.syntax = "mapping";
  evidence.files[0]!.evidence.notices[0] = "changed";
  evidence.skipped.push({ path: "later.yml", reason: "missing-text" });
  evidence.notices[0] = "changed";

  assert.equal(artifact.files[0]?.path, "compose.yml");
  assert.deepEqual(artifact.files[0]?.evidence.services, ["db", "web"]);
  assert.equal(artifact.files[0]?.evidence.relationships[0]?.toService, "db");
  assert.equal(artifact.files[0]?.evidence.relationships[0]?.evidence.syntax, "list");
  assert.notEqual(artifact.files[0]?.evidence.notices[0], "changed");
  assert.deepEqual(artifact.skipped, []);
  assert.notEqual(artifact.notices[0], "changed");

  const tampered = {
    ...artifact,
    files: artifact.files.map((file, index) => index === 0
      ? {
          ...file,
          evidence: {
            ...file.evidence,
            relationships: file.evidence.relationships.map((relationship, relationshipIndex) => relationshipIndex === 0
              ? { ...relationship, toService: "tampered" }
              : relationship),
          },
        }
      : file),
  };
  assert.equal(await verifyRepositoryAuditIntegrity(tampered), false);
});

test("preserves explicit partial evidence and disabled execution capabilities", async () => {
  const evidence = analyzeDockerComposeRelationshipSnapshot(
    snapshot([
      { path: "compose.yml", byteSize: 0 },
      {
        path: "docker-compose.yml",
        byteSize: 60,
        text: `services:\n  web:\n    depends_on: ${"${DEPENDENCIES}"}\n`,
      },
    ]),
  );

  const artifact = await createDockerComposeRelationshipSnapshotArtifact(evidence);

  assert.equal(artifact.status, "partial");
  assert.deepEqual(artifact.skipped, [{ path: "compose.yml", reason: "missing-text" }]);
  assert.equal(artifact.summary.composeFilesSkipped, 1);
  assert.equal(artifact.summary.unsupportedReferences, 1);
  assert.equal(artifact.execution.composeEvaluation, false);
  assert.equal(artifact.execution.containerStart, false);
  assert.equal(artifact.execution.networkAccess, false);
  assert.equal(artifact.execution.writeAccess, false);
  assert.equal(await verifyRepositoryAuditIntegrity(artifact), true);
});

test("creates a browser-ready Docker Compose relationship evidence download", async () => {
  const download = await createDockerComposeRelationshipSnapshotDownload(
    "My Repository.zip",
    completeEvidence(),
  );

  assert.equal(
    download.filename,
    "My-Repository-solvelang-repository-audit-docker-compose-relationships.json",
  );
  assert.equal(download.mediaType, "application/json;charset=utf-8");
  assert.ok(download.content.endsWith("\n"));
  assert.deepEqual(JSON.parse(download.content), download.artifact);
  assert.equal(download.artifact.schema, "solvelang.repository-audit.docker-compose-relationship-snapshot.v1");
  assert.equal(download.artifact.schemaVersion, "1.0.0");
  assert.equal(download.artifact.mode, "analyze-only");
  assert.equal(await verifyRepositoryAuditIntegrity(download.artifact), true);
});
