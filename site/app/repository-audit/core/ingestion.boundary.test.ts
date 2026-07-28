import assert from "node:assert/strict";
import test from "node:test";
import { ingestGitHubSnapshotEntries } from "./ingestion";

const encoder = new TextEncoder();

test("does not retain otherwise inspectable text beyond maxTextBytes", async () => {
  const result = await ingestGitHubSnapshotEntries({
    repositoryFullName: "example/text-boundary",
    commitSha: "4".repeat(40),
    entries: [{ path: "large.txt", kind: "file", bytes: encoder.encode("this text is intentionally too large") }],
    limits: { maxTextBytes: 8 },
  });
  assert.equal(result.snapshot.files[0].text, undefined);
  assert.equal(result.ingestion.textFilesRetained, 0);
});
