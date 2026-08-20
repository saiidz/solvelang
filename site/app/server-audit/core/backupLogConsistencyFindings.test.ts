import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditBackupLogConsistencyFindings } from "./backupLogConsistencyFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(overrides: Partial<ServerAuditSnapshot> = {}): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T10:00:00.000Z",
    host: { hostname: "redacted-host" },
    ...overrides,
  };
}

test("converts backup/log consistency issues into redacted deterministic findings", () => {
  const findings = createServerAuditBackupLogConsistencyFindings(snapshot({
    backups: [
      { name: "sensitive-backup", path: "/secret/a", ageHours: 1, sizeBytes: 10 },
      { name: "sensitive-backup", path: "/secret/b", ageHours: 2, sizeBytes: 20 },
    ],
    logs: [
      { path: "/private/app.log", sizeBytes: 100, modifiedAt: "2026-08-20T09:00:00.000Z" },
      { path: "/private/app.log", sizeBytes: 200, modifiedAt: "2026-08-20T09:30:00.000Z" },
    ],
  }));

  assert.deepEqual(findings.map((finding) => finding.title).sort(), [
    "Backup inventory reports conflicting metadata",
    "Log inventory reports conflicting metadata",
  ]);
  assert.ok(findings.every((finding) => finding.category === "evidence-integrity"));
  assert.ok(findings.every((finding) => finding.evidence.every((item) => /^(backups|logs)\[\d+\]$/.test(item.source))));
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("sensitive-backup"), false);
  assert.equal(serialized.includes("/secret"), false);
  assert.equal(serialized.includes("/private"), false);
});

test("emits no findings when duplicate metadata agrees", () => {
  const findings = createServerAuditBackupLogConsistencyFindings(snapshot({
    backups: [
      { name: "backup-a", ageHours: 1, sizeBytes: 10 },
      { name: "backup-a", ageHours: 1, sizeBytes: 10 },
    ],
    logs: [
      { path: "/redacted/log", sizeBytes: 20 },
      { path: "/redacted/log", sizeBytes: 20 },
    ],
  }));

  assert.deepEqual(findings, []);
});
