import assert from "node:assert/strict";
import test from "node:test";

import { createServerAuditFilesystemArtifactRelationshipFindings } from "./filesystemArtifactRelationshipFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(overrides: Partial<ServerAuditSnapshot> = {}): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T04:00:00.000Z",
    host: { hostname: "example-host" },
    metadata: { redactionsApplied: true },
    ...overrides,
  };
}

test("reports ambiguous filesystem mappings using structural indexes only", () => {
  const findings = createServerAuditFilesystemArtifactRelationshipFindings(snapshot({
    filesystems: [{ mount: "/" }, { mount: "/" }],
    logs: [{ path: "/var/log/app.log", sizeBytes: 42 }],
  }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Log evidence maps ambiguously to filesystem inventory");
  assert.equal(findings[0].severity, "medium");
  assert.deepEqual(findings[0].evidence.map((entry) => entry.source), [
    "filesystems[0]",
    "filesystems[1]",
    "logs[0]",
  ]);
  assert.equal(JSON.stringify(findings).includes("/var/log/app.log"), false);
});

test("reports unresolved and invalid path coverage without exposing paths", () => {
  const findings = createServerAuditFilesystemArtifactRelationshipFindings(snapshot({
    filesystems: [{ mount: "/srv" }, { mount: "relative-mount" }],
    logs: [{ path: "/var/log/app.log" }],
    backups: [{ name: "backup", path: "relative-backup.tar" }],
  }));

  assert.deepEqual(findings.map((finding) => finding.title).sort(), [
    "Filesystem artifact mapping skipped invalid path evidence",
    "Some artifact evidence could not be mapped to a filesystem",
  ]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("/var/log/app.log"), false);
  assert.equal(serialized.includes("relative-backup.tar"), false);
  assert.equal(serialized.includes("relative-mount"), false);
});

test("emits a deterministic limitation finding when relationship output is truncated", () => {
  const logs = Array.from({ length: 501 }, (_, index) => ({ path: `/var/log/app-${index}.log` }));
  const first = createServerAuditFilesystemArtifactRelationshipFindings(snapshot({
    filesystems: [{ mount: "/" }],
    logs,
  }));
  const second = createServerAuditFilesystemArtifactRelationshipFindings(snapshot({
    filesystems: [{ mount: "/" }],
    logs,
  }));

  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0].title, "Filesystem artifact relationships were truncated");
  assert.equal(first[0].severity, "info");
  assert.equal(first[0].evidence[0].summary, "500");
});
