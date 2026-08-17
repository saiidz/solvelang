import assert from "node:assert/strict";
import test from "node:test";
import { defaultSolveGraphScanLimits } from "../../solve-graph/core/limits";
import { analyzeRepositorySnapshot } from "./analysisPipeline";
import type { RepositorySnapshot } from "./inventory";

const secret = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
const hmacKey = new Uint8Array(32).fill(7);

function fixture(files?: RepositorySnapshot["files"]): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "analysis.zip",
      revision: `sha256:${"1".repeat(64)}`,
      fingerprint: `sha256:${"2".repeat(64)}`,
    },
    files: files ?? [
      {
        path: "src/store.ts",
        byteSize: 24,
        sha256: "3".repeat(64),
        text: "export const store = 1;\n",
      },
      {
        path: "src/api.ts",
        byteSize: 100,
        sha256: "4".repeat(64),
        text: `import { store } from "./store";\nconst token = "${secret}";\nexport { store };\n`,
      },
      {
        path: ".env.example",
        byteSize: 25,
        sha256: "5".repeat(64),
        text: "API_KEY=your_key_example\n",
      },
    ],
  };
}

test("composes inventory, dependency impact, and redacted secret warnings without exposing secret values", async () => {
  const result = await analyzeRepositorySnapshot(fixture(), { secretHmacKey: hmacKey });
  assert.equal(result.schema, "solvelang.repository-audit.analysis.v0");
  assert.equal(result.mode, "analyze-only");
  assert.equal(result.execution.status, "complete");
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
  assert.equal(result.graph.graph.source.private, true);
  assert.ok(result.graph.graph.edges.some((edge) => edge.kind === "imports"));
  assert.equal(result.execution.secretFilesScanned, 3);
  assert.equal(result.secretWarnings.length, 1);
  assert.equal(result.execution.redactedSecretMatches, 1);
  assert.equal(result.secretWarnings[0].redacted, true);
  assert.match(result.secretWarnings[0].fingerprint, /^hmac-sha256:[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("a supplied HMAC key makes redacted warning fingerprints reproducible without storing the secret", async () => {
  const left = await analyzeRepositorySnapshot(fixture(), { secretHmacKey: hmacKey });
  const right = await analyzeRepositorySnapshot(fixture(), { secretHmacKey: hmacKey });
  assert.deepEqual(left.secretWarnings, right.secretWarnings);
  assert.ok(!left.secretWarnings[0].fingerprint.includes(secret));
});

test("partial inventory or graph work is surfaced as partial and secondary secret scanning obeys graph bounds", async () => {
  const result = await analyzeRepositorySnapshot(fixture(), {
    inventoryLimits: { maxFiles: 2 },
    graph: {
      graphLimits: { ...defaultSolveGraphScanLimits, maxFiles: 1 },
      intelligence: { maxHotspots: 10, maxImpactDepth: 2, maxImpactResults: 20 },
    },
    secretHmacKey: hmacKey,
  });
  assert.equal(result.execution.status, "partial");
  assert.equal(result.execution.truncated, true);
  assert.ok(result.execution.inventoryTruncationReasons.includes("file-count"));
  assert.ok(result.execution.graphTruncationReasons.includes("file-count"));
  assert.equal(result.execution.secretFilesScanned, 1);
  assert.equal(result.execution.redactedSecretMatches, 0);
  assert.deepEqual(result.secretWarnings, []);
});

test("unsafe repository paths fail closed before redacted secret analysis", async () => {
  await assert.rejects(
    analyzeRepositorySnapshot(fixture([{ path: "../outside.ts", byteSize: 1, text: secret }]), { secretHmacKey: hmacKey }),
    /cannot traverse outside|relative/,
  );
});
