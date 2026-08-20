import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeServerAuditBackupLogConsistency,
} from "./backupLogConsistency";
import type { ServerAuditSnapshot } from "./types";

function snapshot(overrides: Partial<ServerAuditSnapshot> = {}): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T10:00:00.000Z",
    host: { hostname: "redacted-host" },
    ...overrides,
  };
}

test("reports conflicting duplicate backup and log evidence without exposing names or paths", () => {
  const result = analyzeServerAuditBackupLogConsistency(snapshot({
    backups: [
      { name: "customer-db", path: "/secret/backups/db-a.dump", ageHours: 2, sizeBytes: 100 },
      { name: "customer-db", path: "/secret/backups/db-b.dump", ageHours: 5, sizeBytes: 120 },
    ],
    logs: [
      { path: "/private/log/app.log", sizeBytes: 1000, modifiedAt: "2026-08-20T09:00:00.000Z" },
      { path: "/private/log/app.log", sizeBytes: 1200, modifiedAt: "2026-08-20T09:30:00.000Z" },
    ],
  }));

  assert.deepEqual(result.summary, {
    backupsChecked: 2,
    logsChecked: 2,
    conflictingBackupGroups: 1,
    conflictingLogGroups: 1,
  });
  assert.deepEqual(result.issues.map((issue) => issue.kind).sort(), [
    "conflicting-backup-record",
    "conflicting-log-record",
  ]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("customer-db"), false);
  assert.equal(serialized.includes("/secret/backups"), false);
  assert.equal(serialized.includes("/private/log"), false);
  assert.deepEqual(result.execution, {
    networkAccess: false,
    writeAccess: false,
    rawBackupNamesExposed: false,
    rawBackupPathsExposed: false,
    rawLogPathsExposed: false,
    maxIssues: 250,
    issuesTruncated: false,
  });
});

test("ignores byte-for-byte-equivalent duplicate metadata", () => {
  const result = analyzeServerAuditBackupLogConsistency(snapshot({
    backups: [
      { name: "backup-a", path: "/redacted/a", ageHours: 1, sizeBytes: 10 },
      { name: "backup-a", path: "/redacted/a", ageHours: 1, sizeBytes: 10 },
    ],
    logs: [
      { path: "/redacted/app.log", sizeBytes: 20, modifiedAt: "2026-08-20T09:00:00.000Z" },
      { path: "/redacted/app.log", sizeBytes: 20, modifiedAt: "2026-08-20T09:00:00.000Z" },
    ],
  }));

  assert.deepEqual(result.issues, []);
  assert.equal(result.summary.conflictingBackupGroups, 0);
  assert.equal(result.summary.conflictingLogGroups, 0);
});

test("applies a deterministic issue bound after analysis", () => {
  const result = analyzeServerAuditBackupLogConsistency(snapshot({
    backups: [
      { name: "a", ageHours: 1 },
      { name: "a", ageHours: 2 },
      { name: "b", ageHours: 1 },
      { name: "b", ageHours: 3 },
    ],
    logs: [
      { path: "/one", sizeBytes: 1 },
      { path: "/one", sizeBytes: 2 },
    ],
  }), { maxIssues: 1 });

  assert.equal(result.issues.length, 1);
  assert.equal(result.summary.conflictingBackupGroups, 2);
  assert.equal(result.summary.conflictingLogGroups, 1);
  assert.equal(result.execution.issuesTruncated, true);
});

test("rejects invalid issue bounds", () => {
  assert.throws(
    () => analyzeServerAuditBackupLogConsistency(snapshot(), { maxIssues: 0 }),
    /maxIssues must be an integer from 1 through 2000/,
  );
});
