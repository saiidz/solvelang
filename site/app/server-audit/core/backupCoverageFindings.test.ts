import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditBackupCoverageFindings } from "./backupCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(backups: NonNullable<ServerAuditSnapshot["backups"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T14:00:00.000Z",
    host: { hostname: "audit-host" },
    backups,
    metadata: { redactionsApplied: true },
  };
}

test("backup coverage reports missing age evidence without backup identity leakage", () => {
  const findings = createServerAuditBackupCoverageFindings(snapshot([
    { name: "private-customer-a", path: "/backups/private-customer-a" },
    { name: "has-age", path: "/backups/has-age", ageHours: 8 },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "coverage");
  assert.equal(findings[0].title, "Backup record lacks freshness evidence");
  assert.deepEqual(findings[0].evidence, [{ source: "backups[0].ageHours", summary: "freshness evidence is absent" }]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-customer-a"), false);
  assert.equal(serialized.includes("/backups/private-customer-a"), false);
});

test("backup coverage leaves explicit empty inventory and age-bearing records to existing stages", () => {
  assert.deepEqual(createServerAuditBackupCoverageFindings(snapshot([])), []);
  assert.deepEqual(createServerAuditBackupCoverageFindings(snapshot([
    { name: "fresh", ageHours: 1 },
    { name: "stale", ageHours: 100 },
  ])), []);
});

test("backup coverage output is deterministic and bounded", () => {
  const backups = Array.from({ length: 105 }, (_, index) => ({ name: `private-${index}`, path: `/backups/private-${index}` }));
  const first = createServerAuditBackupCoverageFindings(snapshot(backups), { maxFindings: 10 });
  const second = createServerAuditBackupCoverageFindings(snapshot(backups), { maxFindings: 10 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 10);
  assert.equal(first.filter((finding) => finding.title === "Backup record lacks freshness evidence").length, 9);
  assert.equal(first.filter((finding) => finding.title === "Backup freshness coverage findings were truncated").length, 1);
  assert.equal(JSON.stringify(first).includes("private-104"), false);
  assert.throws(() => createServerAuditBackupCoverageFindings(snapshot(backups), { maxFindings: 0 }), /backup-coverage maxFindings/);
});
