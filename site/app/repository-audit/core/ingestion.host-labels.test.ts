// Repository Audit ingestion — host-aware repository labels (Phase 0 of
// the platform-compatibility program).
//
// The ingestion validator historically accepted only the GitHub
// "owner/repository" form. These pins cover the relaxed contract:
//   * the historical form is accepted byte-identically;
//   * host-prefixed forms (host/owner/repository[/...]) are accepted for
//     snapshots whose origin lives on another git host, and the label is
//     carried into snapshot.source.displayName unchanged;
//   * malformed identities — including multi-segment paths whose first
//     segment is not a dotted host — are still rejected.

import assert from "node:assert/strict";
import test from "node:test";
import {
  ingestGitHubSnapshotEntries,
  type RepositorySnapshotEntry,
} from "./ingestion";

const encoder = new TextEncoder();

function textEntry(path: string, value: string): RepositorySnapshotEntry {
  return { path, kind: "file", bytes: encoder.encode(value) };
}

const commitSha = "4".repeat(40);
const entries = [textEntry("src/index.ts", "export const ready = true;")];

test("accepts the historical owner/repository form unchanged", async () => {
  const result = await ingestGitHubSnapshotEntries({ repositoryFullName: "example/repo", commitSha, entries });
  assert.equal(result.snapshot.source.displayName, "example/repo");
  assert.equal(result.snapshot.source.kind, "github");
});

test("accepts host-prefixed labels from other git hosts", async () => {
  const labels = [
    "gitlab.com/group/subgroup/repo",
    "gitea.example.com/owner/repo",
    "codeberg.org/owner/repo",
    "dev.azure.com/org/project/_git/repo",
    "git.sr.ht/~owner/repo",
    "localhost/owner/repo",
    "radicle/z3gqcJUoA1n9HaHKufZs5FCSGazv5",
  ];
  for (const repositoryFullName of labels) {
    const result = await ingestGitHubSnapshotEntries({ repositoryFullName, commitSha, entries });
    assert.equal(result.snapshot.source.displayName, repositoryFullName);
    assert.equal(result.snapshot.source.kind, "github");
  }
});

test("still rejects malformed repository identities", async () => {
  const malformed = [
    "not-a-full-name",
    "example/",
    "/example/repo",
    "example//repo",
    "exam ple/repo",
    "nodot/owner/repo",
    "gitlab.com/owner repo/name",
    "https://github.com/example/repo",
  ];
  for (const repositoryFullName of malformed) {
    await assert.rejects(
      () => ingestGitHubSnapshotEntries({ repositoryFullName, commitSha, entries }),
      /owner\/repository/,
      `expected ${repositoryFullName} to be rejected`,
    );
  }
});
