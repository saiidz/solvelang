import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "./inventory";
import {
  createDockerComposeSnapshotArtifact,
  createDockerComposeSnapshotDownload,
  serializeDockerComposeSnapshotArtifact,
} from "./dockerComposeSnapshotArtifact";
import { analyzeDockerComposeSnapshot } from "./dockerComposeSnapshotEvidence";
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
  return analyzeDockerComposeSnapshot(
    snapshot([
      {
        path: "compose.yml",
        byteSize: 43,
        text: "services:\n  web:\n    image: example/web:1\n",
      },
    ]),
  );
}

test("creates deterministic integrity-covered Docker Compose snapshot evidence", async () => {
  const evidence = completeEvidence();
  const first = await createDockerComposeSnapshotArtifact(evidence);
  const second = await createDockerComposeSnapshotArtifact(evidence);

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.docker-compose-snapshot.v1");
  assert.equal(first.schemaVersion, "1.0.0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.status, "complete");
  assert.equal(first.files[0]?.path, "compose.yml");
  assert.equal(first.files[0]?.evidence.services[0]?.image, "example/web:1");
  assert.equal(first.execution.containerBuild, false);
  assert.equal(first.execution.imageResolution, false);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.equal(await verifyRepositoryAuditIntegrity(first), true);
  assert.ok(serializeDockerComposeSnapshotArtifact(first).endsWith("\n"));
});

test("artifact is detached from mutable snapshot evidence and tampering breaks integrity", async () => {
  const evidence = completeEvidence();
  const artifact = await createDockerComposeSnapshotArtifact(evidence);

  evidence.files[0]!.path = "changed.yml";
  evidence.files[0]!.evidence.services[0]!.name = "changed";
  evidence.files[0]!.evidence.notices[0] = "changed";
  evidence.skipped.push({ path: "later.yml", reason: "missing-text" });
  evidence.notices[0] = "changed";

  assert.equal(artifact.files[0]?.path, "compose.yml");
  assert.equal(artifact.files[0]?.evidence.services[0]?.name, "web");
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
            services: file.evidence.services.map((service, serviceIndex) => serviceIndex === 0
              ? { ...service, image: "example/changed:9" }
              : service),
          },
        }
      : file),
  };
  assert.equal(await verifyRepositoryAuditIntegrity(tampered), false);
});

test("preserves explicit partial evidence and disabled execution capabilities", async () => {
  const evidence = analyzeDockerComposeSnapshot(
    snapshot([
      { path: "compose.yml", byteSize: 0 },
      {
        path: "docker-compose.yml",
        byteSize: 47,
        text: "services:\n  web:\n    image: example/web:1\n",
      },
    ]),
  );

  const artifact = await createDockerComposeSnapshotArtifact(evidence);

  assert.equal(artifact.status, "partial");
  assert.deepEqual(artifact.skipped, [
    { path: "compose.yml", reason: "missing-text" },
  ]);
  assert.equal(artifact.summary.composeFilesSkipped, 1);
  assert.equal(artifact.execution.containerBuild, false);
  assert.equal(artifact.execution.imageResolution, false);
  assert.equal(artifact.execution.networkAccess, false);
  assert.equal(artifact.execution.writeAccess, false);
  assert.equal(await verifyRepositoryAuditIntegrity(artifact), true);
});

test("creates a browser-ready Docker Compose evidence download", async () => {
  const download = await createDockerComposeSnapshotDownload(
    "My Repository.zip",
    completeEvidence(),
  );

  assert.equal(
    download.filename,
    "My-Repository-solvelang-repository-audit-docker-compose.json",
  );
  assert.equal(download.mediaType, "application/json;charset=utf-8");
  assert.ok(download.content.endsWith("\n"));
  assert.deepEqual(JSON.parse(download.content), download.artifact);
  assert.equal(download.artifact.schema, "solvelang.repository-audit.docker-compose-snapshot.v1");
  assert.equal(download.artifact.schemaVersion, "1.0.0");
  assert.equal(download.artifact.mode, "analyze-only");
  assert.equal(await verifyRepositoryAuditIntegrity(download.artifact), true);
});
