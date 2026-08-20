import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "./inventory";
import { analyzeDockerComposeRelationshipSnapshot } from "./dockerComposeRelationshipSnapshotEvidence";

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

test("reports absent Compose relationship evidence without adding capabilities", () => {
  const result = analyzeDockerComposeRelationshipSnapshot(
    snapshot([{ path: "package.json", byteSize: 2, text: "{}" }]),
  );

  assert.equal(result.status, "absent");
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.source, {
    fingerprint: "sha256:example",
    revision: "abc123",
  });
  assert.deepEqual(result.execution, {
    composeEvaluation: false,
    containerStart: false,
    networkAccess: false,
    writeAccess: false,
    maxComposeFiles: 100,
    maxComposeTextBytes: 1024 * 1024,
    maxSkippedEvidence: 100,
    maxRelationshipsPerFile: 1_000,
  });
});

test("composes deterministic depends_on evidence across conventional Compose files", () => {
  const result = analyzeDockerComposeRelationshipSnapshot(
    snapshot([
      {
        path: "ops/docker-compose.prod.yml",
        byteSize: 95,
        text: "services:\n  worker:\n    depends_on:\n      - missing\n  queue:\n    image: queue:1\n",
      },
      {
        path: "compose.yaml",
        byteSize: 87,
        text: "services:\n  web:\n    depends_on:\n      - db\n  db:\n    image: postgres:17\n",
      },
      {
        path: "deployment.yaml",
        byteSize: 13,
        text: "services: {}\n",
      },
    ]),
  );

  assert.equal(result.status, "complete");
  assert.deepEqual(result.files.map((file) => file.path), [
    "compose.yaml",
    "ops/docker-compose.prod.yml",
  ]);
  assert.deepEqual(
    result.files.flatMap((file) => file.evidence.relationships.map((relationship) => `${relationship.fromService}->${relationship.toService}:${relationship.targetState}`)),
    ["web->db:present", "worker->missing:missing"],
  );
  assert.deepEqual(result.summary, {
    composeFilesSeen: 2,
    composeTextsAccepted: 2,
    composeFilesAnalyzed: 2,
    composeFilesSkipped: 0,
    composeFilesOmittedByFileBound: 0,
    servicesSeen: 4,
    relationshipsSeen: 2,
    relationshipsReturned: 2,
    relationshipsHidden: 0,
    missingTargets: 1,
    unsupportedReferences: 0,
    duplicateRelationships: 0,
    skippedEvidenceReturned: 0,
    skippedEvidenceHidden: 0,
  });
});

test("preserves partial truth for unavailable text, oversized files, and unsupported dependencies", () => {
  const result = analyzeDockerComposeRelationshipSnapshot(
    snapshot([
      { path: "compose.yml", byteSize: 0 },
      {
        path: "docker-compose.yml",
        byteSize: 1024 * 1024 + 1,
        text: "services:\n  web:\n    depends_on:\n      - db\n",
      },
      {
        path: "ops/compose.dev.yaml",
        byteSize: 80,
        text: `services:\n  api:\n    depends_on: ${"${DEPENDENCIES}"}\n  db:\n    image: db:1\n`,
      },
    ]),
  );

  assert.equal(result.status, "partial");
  assert.deepEqual(result.files.map((file) => file.path), ["ops/compose.dev.yaml"]);
  assert.equal(result.summary.composeFilesSkipped, 2);
  assert.equal(result.summary.unsupportedReferences, 1);
  assert.deepEqual(result.skipped, [
    { path: "compose.yml", reason: "missing-text" },
    { path: "docker-compose.yml", reason: "compose-too-large" },
  ]);
});

test("applies deterministic per-file relationship bounds and validates the option", () => {
  const result = analyzeDockerComposeRelationshipSnapshot(
    snapshot([{
      path: "compose.yml",
      byteSize: 100,
      text: "services:\n  app:\n    depends_on:\n      - z\n      - a\n  a:\n    image: a:1\n  z:\n    image: z:1\n",
    }]),
    { maxRelationshipsPerFile: 1 },
  );

  assert.equal(result.status, "partial");
  assert.deepEqual(result.files[0]?.evidence.relationships.map((relationship) => relationship.toService), ["a"]);
  assert.equal(result.summary.relationshipsSeen, 2);
  assert.equal(result.summary.relationshipsReturned, 1);
  assert.equal(result.summary.relationshipsHidden, 1);
  assert.throws(
    () => analyzeDockerComposeRelationshipSnapshot(snapshot([]), { maxRelationshipsPerFile: 0 }),
    /maxRelationshipsPerFile must be an integer from 1 through 2000/,
  );
});

test("caps Compose files before analysis in deterministic path order", () => {
  const files = Array.from({ length: 101 }, (_, index) => {
    const suffix = String(index).padStart(3, "0");
    const text = `services:\n  service_${suffix}:\n    image: example/service:${suffix}\n`;
    return {
      path: `deploy/compose.${suffix}.yml`,
      byteSize: new TextEncoder().encode(text).byteLength,
      text,
    };
  });

  const result = analyzeDockerComposeRelationshipSnapshot(snapshot(files));

  assert.equal(result.status, "partial");
  assert.equal(result.summary.composeFilesSeen, 101);
  assert.equal(result.summary.composeFilesAnalyzed, 100);
  assert.equal(result.summary.composeFilesOmittedByFileBound, 1);
  assert.equal(result.files[0]?.path, "deploy/compose.000.yml");
  assert.equal(result.files[99]?.path, "deploy/compose.099.yml");
});
