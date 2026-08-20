import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditFilesystemCoverageFindings } from "./filesystemCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(filesystems: NonNullable<ServerAuditSnapshot["filesystems"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:36:00.000Z",
    host: { hostname: "audit-host" },
    filesystems,
    metadata: { redactionsApplied: true },
  };
}

test("filesystem coverage reports explicit empty inventory but leaves absent section to generic coverage", () => {
  const empty = createServerAuditFilesystemCoverageFindings(snapshot([]));
  assert.equal(empty.length, 1);
  assert.equal(empty[0].title, "No filesystem records supplied");
  assert.deepEqual(empty[0].evidence, [{ source: "filesystems", summary: "0 filesystem records" }]);

  const absent: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:36:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  };
  assert.deepEqual(createServerAuditFilesystemCoverageFindings(absent), []);
});

test("filesystem coverage does not report a concrete filesystem inventory", () => {
  const findings = createServerAuditFilesystemCoverageFindings(snapshot([
    {
      mount: "/private-mount",
      filesystem: "/dev/private-device",
      usagePercent: 42,
    },
  ]));
  assert.deepEqual(findings, []);
});

test("filesystem coverage output is deterministic and emits structural evidence only", () => {
  const first = createServerAuditFilesystemCoverageFindings(snapshot([]));
  const second = createServerAuditFilesystemCoverageFindings(snapshot([]));

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).includes("private-mount"), false);
  assert.equal(JSON.stringify(first).includes("private-device"), false);
  assert.equal(JSON.stringify(first).includes("df -P -B1"), true);
});
