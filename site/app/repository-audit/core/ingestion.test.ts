import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRepositoryInventory } from "./inventory";
import {
  ingestArchiveSnapshotEntries,
  ingestGitHubSnapshotEntries,
  sha256Hex,
  type RepositorySnapshotEntry,
} from "./ingestion";

const encoder = new TextEncoder();

function textEntry(path: string, value: string, generated?: boolean): RepositorySnapshotEntry {
  return { path, kind: "file", bytes: encoder.encode(value), generated };
}

function binaryEntry(path: string, values: number[]): RepositorySnapshotEntry {
  return { path, kind: "file", bytes: new Uint8Array(values) };
}

test("computes a standard SHA-256 digest", async () => {
  assert.equal(
    await sha256Hex(encoder.encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("ingests an immutable GitHub snapshot deterministically and feeds the inventory engine", async () => {
  const entries: RepositorySnapshotEntry[] = [
    textEntry("src/index.ts", "export const ready = true;"),
    textEntry("package.json", JSON.stringify({ dependencies: { next: "16.2.7", react: "19.2.4" } })),
    textEntry("package-lock.json", "{}"),
    { path: "src", kind: "directory" },
    binaryEntry("public/logo.png", [0, 1, 2, 3]),
  ];
  const input = {
    repositoryFullName: "example/automation-app",
    commitSha: "A".repeat(40),
    entries,
  };
  const forward = await ingestGitHubSnapshotEntries(input);
  const reverse = await ingestGitHubSnapshotEntries({ ...input, entries: [...entries].reverse() });

  assert.deepEqual(reverse, forward);
  assert.equal(forward.snapshot.source.kind, "github");
  assert.equal(forward.snapshot.source.revision, "a".repeat(40));
  assert.match(forward.snapshot.source.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(forward.ingestion.filesIngested, 4);
  assert.equal(forward.ingestion.directoriesIgnored, 1);
  assert.equal(forward.ingestion.networkAccess, false);
  assert.equal(forward.ingestion.writeAccess, false);

  const packageFile = forward.snapshot.files.find(({ path }) => path === "package.json");
  const imageFile = forward.snapshot.files.find(({ path }) => path === "public/logo.png");
  assert.ok(packageFile?.text?.includes("next"));
  assert.equal(imageFile?.text, undefined);
  assert.ok(forward.snapshot.files.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256 ?? "")));

  const analysis = analyzeRepositoryInventory(forward.snapshot);
  assert.deepEqual(analysis.inventory.frameworks.map(({ name }) => name), ["Next.js", "React"]);
  assert.deepEqual(analysis.inventory.packageManagers.map(({ name }) => name), ["npm"]);
});

test("ingests archive entries, strips one shared wrapper, and binds revision to archive bytes", async () => {
  const archiveBytes = encoder.encode("fake archive transport bytes");
  const result = await ingestArchiveSnapshotEntries({
    archiveName: "uploads/project.zip",
    archiveBytes,
    entries: [
      { path: "project", kind: "directory" },
      { path: "project/src", kind: "directory" },
      textEntry("project/src/index.ts", "export {};"),
      textEntry("project/README.md", "# Project"),
    ],
  });

  assert.equal(result.snapshot.source.kind, "archive");
  assert.equal(result.snapshot.source.displayName, "project.zip");
  assert.equal(result.snapshot.source.revision, `sha256:${await sha256Hex(archiveBytes)}`);
  assert.equal(result.ingestion.wrapperDirectoryRemoved, "project");
  assert.deepEqual(result.snapshot.files.map(({ path }) => path), ["README.md", "src/index.ts"]);
  assert.equal(result.ingestion.directoriesIgnored, 1);
});

test("does not remove a wrapper when files exist at different archive roots", async () => {
  const result = await ingestArchiveSnapshotEntries({
    archiveName: "mixed.tar.gz",
    archiveBytes: encoder.encode("archive"),
    entries: [textEntry("one/file.ts", "one"), textEntry("two/file.ts", "two")],
  });
  assert.equal(result.ingestion.wrapperDirectoryRemoved, undefined);
  assert.deepEqual(result.snapshot.files.map(({ path }) => path), ["one/file.ts", "two/file.ts"]);
});

test("rejects traversal, absolute paths, backslashes, symlinks, and duplicate normalized paths", async () => {
  const base = { repositoryFullName: "example/repo", commitSha: "1".repeat(40) };
  await assert.rejects(() => ingestGitHubSnapshotEntries({ ...base, entries: [textEntry("../secret", "x")] }), /traverse/);
  await assert.rejects(() => ingestGitHubSnapshotEntries({ ...base, entries: [textEntry("/etc/passwd", "x")] }), /relative/);
  await assert.rejects(() => ingestGitHubSnapshotEntries({ ...base, entries: [textEntry("src\\index.ts", "x")] }), /POSIX/);
  await assert.rejects(() => ingestGitHubSnapshotEntries({ ...base, entries: [{ path: "link", kind: "symlink" }] }), /Symbolic links/);
  await assert.rejects(() => ingestGitHubSnapshotEntries({
    ...base,
    entries: [textEntry("src/index.ts", "a"), textEntry("./src/index.ts", "b")],
  }), /duplicate normalized path/);
});

test("rejects malformed source identities and archive names", async () => {
  await assert.rejects(() => ingestGitHubSnapshotEntries({
    repositoryFullName: "not-a-full-name",
    commitSha: "1".repeat(40),
    entries: [],
  }), /owner\/repository/);
  await assert.rejects(() => ingestGitHubSnapshotEntries({
    repositoryFullName: "example/repo",
    commitSha: "main",
    entries: [],
  }), /immutable/);
  await assert.rejects(() => ingestArchiveSnapshotEntries({
    archiveName: "project.exe",
    archiveBytes: encoder.encode("archive"),
    entries: [],
  }), /supported archive suffix/);
});

test("rejects byte-size mismatches and enforces entry, file, archive, depth, and total limits", async () => {
  const base = { repositoryFullName: "example/repo", commitSha: "1".repeat(40) };
  await assert.rejects(() => ingestGitHubSnapshotEntries({
    ...base,
    entries: [{ ...textEntry("a.txt", "abc"), declaredByteSize: 2 }],
  }), /Declared byte size/);
  await assert.rejects(() => ingestGitHubSnapshotEntries({
    ...base,
    entries: [textEntry("a.txt", "a"), textEntry("b.txt", "b")],
    limits: { maxEntries: 1 },
  }), /entry ingestion limit/);
  await assert.rejects(() => ingestGitHubSnapshotEntries({
    ...base,
    entries: [textEntry("a.txt", "abc")],
    limits: { maxEntryBytes: 2, maxTextBytes: 1 },
  }), /File exceeds/);
  await assert.rejects(() => ingestGitHubSnapshotEntries({
    ...base,
    entries: [textEntry("a/b/c.txt", "x")],
    limits: { maxDepth: 2 },
  }), /depth limit/);
  await assert.rejects(() => ingestGitHubSnapshotEntries({
    ...base,
    entries: [textEntry("a.txt", "abc"), textEntry("b.txt", "def")],
    limits: { maxTotalBytes: 5 },
  }), /Snapshot exceeds/);
  await assert.rejects(() => ingestArchiveSnapshotEntries({
    archiveName: "project.zip",
    archiveBytes: encoder.encode("too large"),
    entries: [],
    limits: { maxArchiveBytes: 2 },
  }), /upload limit/);
});

test("retains only bounded valid UTF-8 text and never returns raw byte arrays", async () => {
  const result = await ingestGitHubSnapshotEntries({
    repositoryFullName: "example/repo",
    commitSha: "2".repeat(40),
    entries: [
      textEntry("small.txt", "visible"),
      textEntry("large.txt", "not retained"),
      binaryEntry("invalid.txt", [0xff, 0xfe, 0xfd]),
      binaryEntry("nul.txt", [65, 0, 66]),
      binaryEntry("asset.bin", [1, 2, 3]),
    ],
    limits: { maxTextBytes: 8 },
  });

  assert.equal(result.snapshot.files.find(({ path }) => path === "small.txt")?.text, "visible");
  assert.equal(result.snapshot.files.find(({ path }) => path === "large.txt")?.text, undefined);
  assert.equal(result.snapshot.files.find(({ path }) => path === "invalid.txt")?.text, undefined);
  assert.equal(result.snapshot.files.find(({ path }) => path === "nul.txt")?.text, undefined);
  assert.equal(result.snapshot.files.find(({ path }) => path === "asset.bin")?.text, undefined);
  assert.ok(!JSON.stringify(result).includes('"bytes"'));
  assert.equal(result.ingestion.textFilesRetained, 1);
});

test("rejects invalid hash-provider output before producing a snapshot", async () => {
  await assert.rejects(() => ingestGitHubSnapshotEntries({
    repositoryFullName: "example/repo",
    commitSha: "3".repeat(40),
    entries: [textEntry("a.txt", "a")],
    hashProvider: async () => "invalid",
  }), /invalid SHA-256/);
});
