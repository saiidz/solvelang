import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "./inventory";
import { analyzeDockerComposeSnapshot } from "./dockerComposeSnapshotEvidence";

function snapshot(
  files: RepositorySnapshot["files"],
): RepositorySnapshot {
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

test("reports absent Compose evidence without adding execution capabilities", () => {
  const result = analyzeDockerComposeSnapshot(
    snapshot([{ path: "package.json", byteSize: 2, text: "{}" }]),
  );

  assert.equal(result.status, "absent");
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.source, {
    fingerprint: "sha256:example",
    revision: "abc123",
  });
  assert.deepEqual(result.execution, {
    containerBuild: false,
    imageResolution: false,
    networkAccess: false,
    writeAccess: false,
    maxComposeFiles: 100,
    maxComposeTextBytes: 1024 * 1024,
    maxSkippedEvidence: 100,
  });
});

test("composes conventional Docker Compose files in deterministic path order", () => {
  const result = analyzeDockerComposeSnapshot(
    snapshot([
      {
        path: "ops/docker-compose.prod.yml",
        byteSize: 54,
        text: "services:\n  worker:\n    image: example/worker:2\n",
      },
      {
        path: "compose.yaml",
        byteSize: 47,
        text: "services:\n  web:\n    image: example/web:1\n",
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
  assert.deepEqual(result.files[0]?.evidence.services, [
    { name: "web", image: "example/web:1", imageState: "declared" },
  ]);
  assert.deepEqual(result.files[1]?.evidence.services, [
    { name: "worker", image: "example/worker:2", imageState: "declared" },
  ]);
  assert.deepEqual(result.summary, {
    composeFilesSeen: 2,
    composeTextsAccepted: 2,
    composeFilesAnalyzed: 2,
    composeFilesSkipped: 0,
    composeFilesOmittedByFileBound: 0,
    skippedEvidenceReturned: 0,
    skippedEvidenceHidden: 0,
  });
});

test("preserves partial truth for missing and oversized Compose text", () => {
  const result = analyzeDockerComposeSnapshot(
    snapshot([
      { path: "compose.yml", byteSize: 0 },
      {
        path: "docker-compose.yml",
        byteSize: 1024 * 1024 + 1,
        text: "services:\n  web:\n    image: example/web:1\n",
      },
      {
        path: "ops/compose.dev.yaml",
        byteSize: 45,
        text: "services:\n  api:\n    image: ${IMAGE}\n",
      },
    ]),
  );

  assert.equal(result.status, "partial");
  assert.deepEqual(result.files.map((file) => file.path), ["ops/compose.dev.yaml"]);
  assert.deepEqual(result.files[0]?.evidence.services, [
    { name: "api", imageState: "unresolved" },
  ]);
  assert.deepEqual(result.skipped, [
    { path: "compose.yml", reason: "missing-text" },
    { path: "docker-compose.yml", reason: "compose-too-large" },
  ]);
  assert.equal(result.summary.composeFilesSkipped, 2);
});

test("caps the number of Compose files deterministically", () => {
  const files = Array.from({ length: 101 }, (_, index) => {
    const suffix = String(index).padStart(3, "0");
    const text = `services:\n  service_${suffix}:\n    image: example/service:${suffix}\n`;
    return {
      path: `deploy/compose.${suffix}.yml`,
      byteSize: new TextEncoder().encode(text).byteLength,
      text,
    };
  });

  const result = analyzeDockerComposeSnapshot(snapshot(files));

  assert.equal(result.status, "partial");
  assert.equal(result.summary.composeFilesSeen, 101);
  assert.equal(result.summary.composeFilesAnalyzed, 100);
  assert.equal(result.summary.composeFilesOmittedByFileBound, 1);
  assert.equal(result.files.length, 100);
  assert.equal(result.files[0]?.path, "deploy/compose.000.yml");
  assert.equal(result.files[99]?.path, "deploy/compose.099.yml");
  assert.match(result.notices.join("\n"), /1 additional Compose file\(s\) were omitted/);
});
