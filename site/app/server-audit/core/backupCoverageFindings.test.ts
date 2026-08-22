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

test("backup coverage reports missing freshness and size evidence without backup identity leakage", () => {
  const findings = createServerAuditBackupCoverageFindings(snapshot([
    { name: "private-customer-a", path: "/backups/private-customer-a" },
    { name: "has-all", path: "/backups/has-all", ageHours: 8, sizeBytes: 1024 },
  ]));

  assert.equal(findings.length, 2);
  const freshness = findings.find((finding) => finding.title === "Backup record lacks freshness evidence");
  const size = findings.find((finding) => finding.title === "Backup record lacks size evidence");
  assert.ok(freshness);
  assert.ok(size);
  assert.equal(freshness.category, "coverage");
  assert.equal(size.category, "coverage");
  assert.deepEqual(freshness.evidence, [{ source: "backups[0].ageHours", summary: "freshness evidence is absent" }]);
  assert.deepEqual(size.evidence, [{ source: "backups[0].sizeBytes", summary: "size evidence is absent" }]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-customer-a"), false);
  assert.equal(serialized.includes("/backups/private-customer-a"), false);
});

test("backup coverage leaves explicit empty inventory and fully evidenced records to existing stages", () => {
  assert.deepEqual(createServerAuditBackupCoverageFindings(snapshot([])), []);
  assert.deepEqual(createServerAuditBackupCoverageFindings(snapshot([
    { name: "fresh", ageHours: 1, sizeBytes: 2048 },
    { name: "stale", ageHours: 100, sizeBytes: 4096 },
  ])), []);
});

test("backup coverage reports only the dimension that is absent", () => {
  const findings = createServerAuditBackupCoverageFindings(snapshot([
    { name: "age-only", ageHours: 4 },
    { name: "size-only", sizeBytes: 512 },
  ]));

  assert.equal(findings.length, 2);
  assert.ok(findings.some((finding) => finding.evidence[0]?.source === "backups[0].sizeBytes"));
  assert.ok(findings.some((finding) => finding.evidence[0]?.source === "backups[1].ageHours"));
});

test("backup coverage output is deterministic and bounded", () => {
  const backups = Array.from({ length: 105 }, (_, index) => ({ name: `private-${index}`, path: `/backups/private-${index}` }));
  const first = createServerAuditBackupCoverageFindings(snapshot(backups), { maxFindings: 10 });
  const second = createServerAuditBackupCoverageFindings(snapshot(backups), { maxFindings: 10 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 10);
  assert.equal(first.filter((finding) => finding.title === "Backup evidence coverage findings were truncated").length, 1);
  assert.equal(first.filter((finding) => finding.title !== "Backup evidence coverage findings were truncated").length, 9);
  assert.equal(JSON.stringify(first).includes("private-104"), false);
  assert.throws(() => createServerAuditBackupCoverageFindings(snapshot(backups), { maxFindings: 0 }), /backup-coverage maxFindings/);
});

test("high-cardinality backup coverage retains only the bounded deterministic finding prefix", () => {
  const backups = Array.from({ length: 5_000 }, (_, index) => ({
    name: `private-backup-${index}`,
    path: `/private/backups/${index}`,
  }));
  const findings = createServerAuditBackupCoverageFindings(snapshot(backups), { maxFindings: 1_000 });
  const limitation = findings.find((finding) => finding.title === "Backup evidence coverage findings were truncated");

  assert.equal(findings.length, 1_000);
  assert.equal(findings.filter((finding) => finding.title !== "Backup evidence coverage findings were truncated").length, 999);
  assert.match(limitation?.summary ?? "", /produced 10000 findings/);
  assert.match(limitation?.summary ?? "", /first 999 deterministic findings/);
  assert.equal(limitation?.evidence[0]?.source, "backups");
  assert.equal(limitation?.evidence[0]?.summary, "finding limit 1000 reached");
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-backup-"), false);
  assert.equal(serialized.includes("/private/backups/"), false);
});
