import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "./inventory";
import { analyzeNodeWorkspaceSnapshot } from "./nodeWorkspaceSnapshotEvidence";

const encoder = new TextEncoder();

function file(path: string, text?: string) {
  return {
    path,
    byteSize: text === undefined ? 0 : encoder.encode(text).byteLength,
    ...(text === undefined ? {} : { text }),
  };
}

function snapshot(files: RepositorySnapshot["files"]): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "fixture",
      revision: "rev-1",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    files,
  };
}

test("composes deterministic workspace evidence from bounded snapshot manifests", () => {
  const result = analyzeNodeWorkspaceSnapshot(
    snapshot([
      file("packages/b/package.json", "bad"),
      file("README.md", "docs"),
      file("package.json", '{"workspaces":["packages/*"],"packageManager":"pnpm@9"}'),
      file("packages/a/package.json", '{"name":"@fixture/a"}'),
    ]),
  );

  assert.equal(result.status, "complete");
  assert.equal(result.rootPackageJson, "package.json");
  assert.deepEqual(result.workspace?.workspacePatterns, ["packages/*"]);
  assert.deepEqual(
    result.workspace?.members.map((member) => [member.path, member.state]),
    [
      ["packages/a/package.json", "resolved"],
      ["packages/b/package.json", "unresolved"],
    ],
  );
  assert.deepEqual(result.summary, {
    packageManifestsSeen: 3,
    manifestTextsAccepted: 3,
    packageManifestsSkipped: 0,
    skippedEvidenceReturned: 0,
    skippedEvidenceHidden: 0,
  });
  assert.deepEqual(result.execution, {
    networkAccess: false,
    writeAccess: false,
    maxManifestTextBytes: 1024 * 1024,
    maxSkippedEvidence: 100,
  });
});

test("preserves missing and over-bound manifest truth without reading from disk", () => {
  const rootText = '{"workspaces":["packages/*"]}';
  const result = analyzeNodeWorkspaceSnapshot(
    snapshot([
      file("package.json", rootText),
      file("packages/a/package.json"),
      {
        path: "packages/b/package.json",
        byteSize: 100,
        text: '{"name":"@fixture/b"}',
      },
      file("packages/c/package.json", '{"name":"@fixture/c"}'),
    ]),
    { maxManifestTextBytes: 64 },
  );

  assert.equal(result.status, "partial");
  assert.deepEqual(result.skipped, [
    { path: "packages/a/package.json", reason: "missing-text" },
    { path: "packages/b/package.json", reason: "manifest-too-large" },
  ]);
  assert.deepEqual(result.workspace?.members.map((member) => member.path), [
    "packages/c/package.json",
  ]);
  assert.equal(result.summary.packageManifestsSkipped, 2);
  assert.match(result.notices.join(" "), /2 package manifest\(s\) were omitted/);
});

test("reports absent root package metadata without inferring a workspace", () => {
  const result = analyzeNodeWorkspaceSnapshot(
    snapshot([file("packages/a/package.json", '{"name":"@fixture/a"}')]),
  );

  assert.equal(result.status, "absent");
  assert.equal(result.rootPackageJson, null);
  assert.equal(result.workspace, undefined);
  assert.match(result.notices.join(" "), /No repository-root package\.json/);
});

test("fails partial when the root package manifest text is unavailable", () => {
  const result = analyzeNodeWorkspaceSnapshot(
    snapshot([
      file("package.json"),
      file("packages/a/package.json", '{"name":"@fixture/a"}'),
    ]),
  );

  assert.equal(result.status, "partial");
  assert.equal(result.workspace, undefined);
  assert.equal(result.summary.manifestTextsAccepted, 1);
  assert.deepEqual(result.skipped, [
    { path: "package.json", reason: "missing-text" },
  ]);
});

test("rejects invalid manifest byte bounds", () => {
  const input = snapshot([]);
  assert.throws(
    () => analyzeNodeWorkspaceSnapshot(input, { maxManifestTextBytes: 0 }),
    /manifest byte bound/,
  );
  assert.throws(
    () => analyzeNodeWorkspaceSnapshot(input, { maxManifestTextBytes: 10 * 1024 * 1024 + 1 }),
    /manifest byte bound/,
  );
});
