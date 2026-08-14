import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "./inventory";
import { scanRepositorySecrets } from "./secretScan";

const source = {
  kind: "archive" as const,
  displayName: "fixture.zip",
  revision: `sha256:${"1".repeat(64)}`,
  fingerprint: `sha256:${"2".repeat(64)}`,
};
const hmacKey = new Uint8Array(32).fill(7);

function snapshot(path: string, text: string): RepositorySnapshot {
  return {
    source,
    files: [{ path, text, byteSize: text.length }],
  };
}

test("recognizes encrypted PKCS#8 private keys", async () => {
  const warnings = await scanRepositorySecrets(
    snapshot("keys/private.pem", "-----BEGIN ENCRYPTED PRIVATE KEY-----\nredacted\n-----END ENCRYPTED PRIVATE KEY-----"),
    { hmacKey },
  );
  assert.equal(warnings.filter((warning) => warning.patternClass === "private-key").length, 1);
});

test("preserves two distinct same-class secrets on one line without exposing raw values", async () => {
  const first = `ghp_${"A".repeat(24)}`;
  const second = `ghp_${"B".repeat(24)}`;
  const warnings = await scanRepositorySecrets(
    snapshot("public/config.js", `const first = "${first}"; const second = "${second}";`),
    { hmacKey },
  );
  const tokens = warnings.filter((warning) => warning.patternClass === "token");
  assert.equal(tokens.length, 2);
  assert.notEqual(tokens[0].warningId, tokens[1].warningId);
  assert.notEqual(tokens[0].fingerprint, tokens[1].fingerprint);
  assert.equal(tokens[0].exposure, "public-path");
  assert.equal(tokens[1].exposure, "public-path");
  const serialized = JSON.stringify(warnings);
  assert.equal(serialized.includes(first), false);
  assert.equal(serialized.includes(second), false);
});

test("deduplicates overlapping detectors for the same secret position", async () => {
  const token = `ghp_${"C".repeat(24)}`;
  const warnings = await scanRepositorySecrets(
    snapshot("src/config.ts", `api_key=${token}`),
    { hmacKey },
  );
  assert.equal(warnings.filter((warning) => warning.patternClass === "token").length, 1);
});
