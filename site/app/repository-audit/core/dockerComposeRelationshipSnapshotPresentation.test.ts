import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "./inventory";
import { analyzeDockerComposeRelationshipSnapshot } from "./dockerComposeRelationshipSnapshotEvidence";
import { createDockerComposeRelationshipSnapshotPresentation } from "./dockerComposeRelationshipSnapshotPresentation";

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

test("presents deterministic Compose dependency rows with target truth", () => {
  const evidence = analyzeDockerComposeRelationshipSnapshot(
    snapshot([
      {
        path: "ops/docker-compose.prod.yml",
        byteSize: 80,
        text: "services:\n  worker:\n    depends_on:\n      - missing\n",
      },
      {
        path: "compose.yml",
        byteSize: 96,
        text: "services:\n  web:\n    depends_on:\n      - db\n  db:\n    image: postgres:17\n",
      },
    ]),
  );

  const presentation = createDockerComposeRelationshipSnapshotPresentation(evidence);

  assert.equal(presentation.status, "complete");
  assert.deepEqual(presentation.rows, [
    {
      composePath: "compose.yml",
      fromService: "web",
      toService: "db",
      targetState: "present",
      syntax: "list",
    },
    {
      composePath: "ops/docker-compose.prod.yml",
      fromService: "worker",
      toService: "missing",
      targetState: "missing",
      syntax: "list",
    },
  ]);
  assert.deepEqual(presentation.summary, {
    composeFiles: 2,
    servicesSeen: 3,
    relationshipsSeen: 2,
    relationshipsReturnedByEvidence: 2,
    relationshipsHiddenByEvidenceBound: 0,
    missingTargets: 1,
    unsupportedReferences: 0,
    composeFilesSkipped: 0,
    composeFilesOmittedByFileBound: 0,
    rowsShown: 2,
    rowsHiddenByPresentationBound: 0,
  });
  assert.deepEqual(presentation.execution, {
    composeEvaluation: false,
    containerStart: false,
    networkAccess: false,
    writeAccess: false,
    maxRows: 200,
    rowsTruncated: false,
    sourcePartial: false,
  });
});

test("keeps source partiality separate from presentation truncation", () => {
  const evidence = analyzeDockerComposeRelationshipSnapshot(
    snapshot([{
      path: "compose.yml",
      byteSize: 120,
      text: `services:\n  app:\n    depends_on:\n      - z\n      - a\n      - ${"${DYNAMIC_SERVICE}"}\n  a:\n    image: a:1\n  z:\n    image: z:1\n`,
    }]),
  );

  const presentation = createDockerComposeRelationshipSnapshotPresentation(evidence, { maxRows: 1 });

  assert.equal(presentation.status, "partial");
  assert.equal(presentation.execution.sourcePartial, true);
  assert.equal(presentation.execution.rowsTruncated, true);
  assert.equal(presentation.summary.relationshipsSeen, 2);
  assert.equal(presentation.summary.unsupportedReferences, 1);
  assert.equal(presentation.summary.rowsShown, 1);
  assert.equal(presentation.summary.rowsHiddenByPresentationBound, 1);
  assert.deepEqual(presentation.rows.map((row) => row.toService), ["a"]);
  assert.match(presentation.notices.join("\n"), /skipped instead of guessed/);
  assert.match(presentation.notices.join("\n"), /first deterministic bounded subset/);
});

test("keeps evidence-bound truncation distinct from presentation-bound truncation", () => {
  const evidence = analyzeDockerComposeRelationshipSnapshot(
    snapshot([{
      path: "compose.yml",
      byteSize: 100,
      text: "services:\n  app:\n    depends_on:\n      - z\n      - a\n  a:\n    image: a:1\n  z:\n    image: z:1\n",
    }]),
    { maxRelationshipsPerFile: 1 },
  );

  const presentation = createDockerComposeRelationshipSnapshotPresentation(evidence, { maxRows: 10 });

  assert.equal(presentation.status, "partial");
  assert.equal(presentation.summary.relationshipsSeen, 2);
  assert.equal(presentation.summary.relationshipsReturnedByEvidence, 1);
  assert.equal(presentation.summary.relationshipsHiddenByEvidenceBound, 1);
  assert.equal(presentation.summary.rowsHiddenByPresentationBound, 0);
  assert.equal(presentation.execution.rowsTruncated, false);
  assert.match(presentation.notices.join("\n"), /hidden by evidence bounds/);
});

test("presents absent evidence and validates row bounds", () => {
  const evidence = analyzeDockerComposeRelationshipSnapshot(
    snapshot([{ path: "package.json", byteSize: 2, text: "{}" }]),
  );
  const presentation = createDockerComposeRelationshipSnapshotPresentation(evidence);

  assert.equal(presentation.status, "absent");
  assert.deepEqual(presentation.rows, []);
  assert.match(presentation.notices.join("\n"), /No conventional Docker Compose/);
  assert.throws(
    () => createDockerComposeRelationshipSnapshotPresentation(evidence, { maxRows: 0 }),
    /maxRows must be an integer from 1 through 2000/,
  );
});
