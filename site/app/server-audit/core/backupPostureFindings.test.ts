import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditBackupPostureFindings } from "./backupPostureFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(backups: NonNullable<ServerAuditSnapshot["backups"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T18:50:00.000Z",
    host: { hostname: "audit-host" },
    backups,
  };
}

test("fresh non-empty backup evidence produces no finding", () => {
  assert.deepEqual(createServerAuditBackupPostureFindings(snapshot([
    { name: "private-customer-backup", path: "/backup/private-customer", ageHours: 12, sizeBytes: 1024 },
  ])), []);
});

test("older retained backup evidence does not make posture stale when a newer backup is fresh", () => {
  const findings = createServerAuditBackupPostureFindings(snapshot([
    { name: "private-old", path: "/backup/private-old", ageHours: 240, sizeBytes: 1024 },
    { name: "private-fresh", path: "/backup/private-fresh", ageHours: 12, sizeBytes: 1024 },
  ]));

  assert.deepEqual(findings, []);
});

test("stale backup posture uses the youngest available age and withholds names and paths", () => {
  const findings = createServerAuditBackupPostureFindings(snapshot([
    { name: "private-older", path: "/backup/private-older", ageHours: 144, sizeBytes: 1024 },
    { name: "private-youngest", path: "/backup/private-youngest", ageHours: 96, sizeBytes: 1024 },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "medium");
  assert.equal(findings[0].evidence[0].source, "backups[1].ageHours");
  assert.equal(findings[0].evidence[0].summary, "96 hours");
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-"), false);
  assert.equal(serialized.includes("/backup"), false);
});

test("backup evidence exactly at the threshold is not stale", () => {
  assert.deepEqual(createServerAuditBackupPostureFindings(snapshot([
    { name: "private-threshold", path: "/backup/private-threshold", ageHours: 72, sizeBytes: 1024 },
  ])), []);
});

test("zero-byte backup evidence is conservative and structural", () => {
  const findings = createServerAuditBackupPostureFindings(snapshot([
    { name: "secret-name", path: "/backups/secret-name", ageHours: 1, sizeBytes: 0 },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "low");
  assert.equal(findings[0].title, "Backup evidence reports a zero-byte file");
  assert.equal(findings[0].evidence[0].source, "backups[0].sizeBytes");
  assert.equal(JSON.stringify(findings).includes("secret-name"), false);
});

test("backup posture findings are deterministic and bounded", () => {
  const backups = Array.from({ length: 10 }, (_, index) => ({
    name: `private-${index}`,
    path: `/backup/private-${index}`,
    ageHours: 100 + index,
    sizeBytes: 0,
  }));
  const input = snapshot(backups);
  const first = createServerAuditBackupPostureFindings(input, { maxFindings: 5 });
  const second = createServerAuditBackupPostureFindings(input, { maxFindings: 5 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  assert.equal(first.filter((finding) => finding.title === "Public-file coverage findings were truncated").length, 0);
  assert.equal(first.filter((finding) => finding.title === "Backup posture findings were truncated").length, 1);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  assert.equal(JSON.stringify(first).includes("private-"), false);
});

test("backup posture option bounds fail closed", () => {
  const input = snapshot([]);
  assert.throws(() => createServerAuditBackupPostureFindings(input, { maxFindings: 0 }), /maxFindings/);
  assert.throws(() => createServerAuditBackupPostureFindings(input, { staleAfterHours: 0 }), /staleAfterHours/);
  assert.throws(() => createServerAuditBackupPostureFindings(input, { staleAfterHours: Number.POSITIVE_INFINITY }), /staleAfterHours/);
});
