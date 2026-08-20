import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "./inventory";
import { analyzeDockerComposeSnapshot } from "./dockerComposeSnapshotEvidence";
import { createDockerComposeSnapshotPresentation } from "./dockerComposeSnapshotPresentation";

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

test("presents Compose services in deterministic file and service order", () => {
  const evidence = analyzeDockerComposeSnapshot(
    snapshot([
      {
        path: "ops/docker-compose.prod.yml",
        byteSize: 84,
        text: "services:\n  worker:\n    image: example/worker:2\n  api:\n    image: ${API_IMAGE}\n",
      },
      {
        path: "compose.yaml",
        byteSize: 47,
        text: "services:\n  web:\n    image: example/web:1\n",
      },
    ]),
  );

  const result = createDockerComposeSnapshotPresentation(evidence);

  assert.equal(result.schema, "solvelang.repository-audit.docker-compose-presentation.v0");
  assert.equal(result.status, "complete");
  assert.deepEqual(result.rows, [
    {
      composePath: "compose.yaml",
      serviceName: "web",
      image: "example/web:1",
      imageState: "declared",
    },
    {
      composePath: "ops/docker-compose.prod.yml",
      serviceName: "api",
      imageState: "unresolved",
    },
    {
      composePath: "ops/docker-compose.prod.yml",
      serviceName: "worker",
      image: "example/worker:2",
      imageState: "declared",
    },
  ]);
  assert.deepEqual(result.summary, {
    composeFiles: 2,
    services: 3,
    declaredImages: 2,
    unresolvedImages: 1,
    composeFilesSkipped: 0,
    composeFilesOmittedByFileBound: 0,
    rowsShown: 3,
    rowsHidden: 0,
  });
  assert.deepEqual(result.execution, {
    containerBuild: false,
    imageResolution: false,
    networkAccess: false,
    writeAccess: false,
    maxRows: 200,
    rowsTruncated: false,
    sourcePartial: false,
  });
});

test("keeps source partiality separate from presentation row truncation", () => {
  const evidence = analyzeDockerComposeSnapshot(
    snapshot([
      { path: "compose.yml", byteSize: 0 },
      {
        path: "docker-compose.yml",
        byteSize: 82,
        text: "services:\n  z:\n    image: example/z:1\n  a:\n    image: example/a:1\n",
      },
    ]),
  );

  const result = createDockerComposeSnapshotPresentation(evidence, { maxRows: 1 });

  assert.equal(result.status, "partial");
  assert.equal(result.execution.sourcePartial, true);
  assert.equal(result.execution.rowsTruncated, true);
  assert.equal(result.summary.services, 2);
  assert.equal(result.summary.rowsShown, 1);
  assert.equal(result.summary.rowsHidden, 1);
  assert.equal(result.summary.composeFilesSkipped, 1);
  assert.equal(result.rows[0]?.serviceName, "a");
  assert.match(result.notices.join("\n"), /1 Compose file\(s\) were skipped/);
  assert.match(result.notices.join("\n"), /first deterministic bounded subset/);
});

test("reports absent Compose evidence explicitly", () => {
  const evidence = analyzeDockerComposeSnapshot(
    snapshot([{ path: "README.md", byteSize: 5, text: "hello" }]),
  );
  const result = createDockerComposeSnapshotPresentation(evidence);

  assert.equal(result.status, "absent");
  assert.deepEqual(result.rows, []);
  assert.equal(result.summary.services, 0);
  assert.equal(result.execution.sourcePartial, false);
  assert.match(result.notices[0] ?? "", /No conventional Docker Compose YAML files/);
});

test("validates deterministic presentation row bounds", () => {
  const evidence = analyzeDockerComposeSnapshot(
    snapshot([
      {
        path: "compose.yml",
        byteSize: 43,
        text: "services:\n  web:\n    image: example/web:1\n",
      },
    ]),
  );

  assert.throws(
    () => createDockerComposeSnapshotPresentation(evidence, { maxRows: 0 }),
    /must be an integer from 1 through 2000/,
  );
  assert.throws(
    () => createDockerComposeSnapshotPresentation(evidence, { maxRows: 2_001 }),
    /must be an integer from 1 through 2000/,
  );
});
