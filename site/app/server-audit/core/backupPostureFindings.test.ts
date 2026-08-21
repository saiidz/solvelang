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

test("stale backup evidence is structural and withholds name and path", () => {
  const findings = createServerAuditBackupPostureFindings(snapshot([
    { name: "private-customer-backup", path: "/backup/private-customer", ageHours: 96, sizeBytes: 1024 },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "medium");
  assert.equal(findings[0].evidence[0].source, "backups[0].ageHours");
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-customer"), false);
  assert.equal(serialized.includes("/backup"), false);
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
  assert.equal(first.filter((finding) => finding.title === "Backup posture findings were truncated").length, 1);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  assert.equal(JSON.stringify(first).includes("private-"), false);
});

test("backup posture retention stays bounded when every backup produces two findings", () => {
  const backups = Array.from({ length: 5_000 }, (_, index) => ({
    name: `private-${index}`,
    path: `/backup/private-${index}`,
    ageHours: 100 + index,
    sizeBytes: 0,
  }));
  const input = snapshot(backups);
  const first = createServerAuditBackupPostureFindings(input, { maxFindings: 1_000 });
  const second = createServerAuditBackupPostureFindings(structuredClone(input), { maxFindings: 1_000 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 1_000);
  assert.equal(first.filter((finding) => finding.title === "Backup evidence is older than the configured freshness threshold").length, 999);
  const limitation = first.find((finding) => finding.title === "Backup posture findings were truncated");
  assert.ok(limitation);
  assert.match(limitation.summary, /produced 10000 findings/);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  assert.equal(JSON.stringify(first).includes("private-"), false);
});

test("backup posture option bounds fail closed", () => {
  const input = snapshot([]);
  assert.throws(() => createServerAuditBackupPostureFindings(input, { maxFindings: 0 }), /maxFindings/);
  assert.throws(() => createServerAuditBackupPostureFindings(input, { staleAfterHours: 0 }), /staleAfterHours/);
  assert.throws(() => createServerAuditBackupPostureFindings(input, { staleAfterHours: Number.POSITIVE_INFINITY }), /staleAfterHours/);
});
