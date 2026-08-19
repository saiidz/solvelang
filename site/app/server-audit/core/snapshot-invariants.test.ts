import assert from "node:assert/strict";
import test from "node:test";
import { parseServerAuditSnapshot } from "./snapshot";

function snapshot(overrides: Record<string, unknown>) {
  return JSON.stringify({
    schemaVersion: "1",
    collectedAt: "2026-08-17T14:00:00.000Z",
    host: { hostname: "audit-host" },
    ...overrides,
  });
}

test("rejects memory availability that exceeds total memory", () => {
  assert.throws(
    () => parseServerAuditSnapshot(snapshot({ system: { memoryTotalBytes: 1024, memoryAvailableBytes: 2048 } })),
    /memoryAvailableBytes exceeds system\.memoryTotalBytes/,
  );

  assert.doesNotThrow(() =>
    parseServerAuditSnapshot(snapshot({ system: { memoryTotalBytes: 2048, memoryAvailableBytes: 1024 } })),
  );
});

test("rejects filesystem capacity totals that cannot be true", () => {
  assert.throws(
    () => parseServerAuditSnapshot(snapshot({ filesystems: [{ mount: "/", sizeBytes: 100, usedBytes: 101, availableBytes: 0 }] })),
    /usedBytes exceeds sizeBytes/,
  );
  assert.throws(
    () => parseServerAuditSnapshot(snapshot({ filesystems: [{ mount: "/", sizeBytes: 100, usedBytes: 0, availableBytes: 101 }] })),
    /availableBytes exceeds sizeBytes/,
  );
  assert.throws(
    () => parseServerAuditSnapshot(snapshot({ filesystems: [{ mount: "/", sizeBytes: 100, usedBytes: 80, availableBytes: 30 }] })),
    /usedBytes plus availableBytes exceeds sizeBytes/,
  );

  assert.doesNotThrow(() =>
    parseServerAuditSnapshot(snapshot({ filesystems: [{ mount: "/", sizeBytes: 100, usedBytes: 70, availableBytes: 20, usagePercent: 70 }] })),
  );
});
