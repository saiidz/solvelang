import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRepositorySnapshot } from "./analysisPipeline";
import { createCanonicalRepositoryAuditArtifact } from "./canonicalArtifact";
import type { RepositorySnapshot } from "./inventory";

const secret = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
const hmacKey = new Uint8Array(32).fill(11);

function fixture(): RepositorySnapshot {
  const store = "export const store = 1;\n";
  const api = `import { store } from "./store";\nconst token = "${secret}";\nexport { store };\n`;
  return {
    source: {
      kind: "archive",
      displayName: "Browser Evidence.zip",
      revision: `sha256:${"1".repeat(64)}`,
      fingerprint: `sha256:${"2".repeat(64)}`,
    },
    files: [
      { path: "src/store.ts", byteSize: new TextEncoder().encode(store).byteLength, sha256: "3".repeat(64), text: store },
      { path: "src/api.ts", byteSize: new TextEncoder().encode(api).byteLength, sha256: "4".repeat(64), text: api },
    ],
  };
}

test("creates a versioned integrity-covered canonical browser artifact without secret correlation material", async () => {
  const intelligence = await analyzeRepositorySnapshot(fixture(), { secretHmacKey: hmacKey });
  const artifact = await createCanonicalRepositoryAuditArtifact({
    archiveName: "Browser Evidence.zip",
    analysis: intelligence.inventory,
    intelligence,
    maxArchiveEntries: 20_000,
    now: new Date("2026-08-17T09:50:00.000Z"),
  });

  assert.equal(artifact.filename, "Browser-Evidence-solvelang-repository-audit-canonical.json");
  assert.equal(artifact.mediaType, "application/json;charset=utf-8");
  assert.equal(artifact.report.schemaVersion, "1.1.0");
  assert.equal(artifact.report.mode, "analyze-only");
  assert.equal(artifact.report.execution.networkAccess, false);
  assert.equal(artifact.report.execution.writeAccess, false);
  assert.ok(artifact.report.graph);
  assert.ok(artifact.report.graph.counts.edges > 0);
  assert.equal(artifact.report.detections.secretExposureWarnings.length, 1);
  assert.match(artifact.report.integrity.canonicalJsonSha256, /^sha256:[a-f0-9]{64}$/);
  assert.ok(artifact.content.endsWith("\n"));
  assert.ok(!artifact.content.includes(secret));
  assert.ok(!artifact.content.includes("hmac-sha256:"));

  const parsed = JSON.parse(artifact.content) as { schemaVersion: string; integrity: { canonicalJsonSha256: string } };
  assert.equal(parsed.schemaVersion, "1.1.0");
  assert.equal(parsed.integrity.canonicalJsonSha256, artifact.report.integrity.canonicalJsonSha256);
});
