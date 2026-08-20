import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function contradictorySnapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T12:00:00.000Z",
    host: { hostname: "audit-host" },
    backups: [
      { name: "sensitive-backup", path: "/secret/a", ageHours: 1, sizeBytes: 10 },
      { name: "sensitive-backup", path: "/secret/b", ageHours: 2, sizeBytes: 20 },
    ],
    logs: [
      { path: "/private/app.log", sizeBytes: 100, modifiedAt: "2026-08-20T11:00:00.000Z" },
      { path: "/private/app.log", sizeBytes: 200, modifiedAt: "2026-08-20T11:30:00.000Z" },
    ],
    metadata: { redactionsApplied: true },
  };
}

function overlappingSnapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T12:00:00.000Z",
    host: { hostname: "audit-host" },
    backups: [
      { name: "same-backup", path: "/same/private.tar", ageHours: 1, sizeBytes: 10 },
      { name: "same-backup", path: "/same/private.tar", ageHours: 2, sizeBytes: 20 },
    ],
    logs: [
      { path: "/same/private.log", sizeBytes: 100, modifiedAt: "2026-08-20T11:00:00.000Z" },
      { path: "/same/private.log", sizeBytes: 200, modifiedAt: "2026-08-20T11:30:00.000Z" },
    ],
    metadata: { redactionsApplied: true },
  };
}

function consistencyFindings(snapshot: ServerAuditSnapshot) {
  return createServerAuditReport(snapshot, "2026-08-20T12:01:00.000Z").findings.filter(
    (finding) => finding.category === "evidence-integrity"
      && (finding.title === "Backup inventory reports conflicting metadata"
        || finding.title === "Log inventory reports conflicting metadata"),
  );
}

test("canonical reports compose backup/log consistency findings with structural redacted evidence", () => {
  const report = createServerAuditReport(contradictorySnapshot(), "2026-08-20T12:01:00.000Z");
  const consistency = consistencyFindings(contradictorySnapshot());

  assert.equal(consistency.length, 2);
  assert.deepEqual(consistency.map((finding) => finding.title).sort(), [
    "Backup inventory reports conflicting metadata",
    "Log inventory reports conflicting metadata",
  ]);
  assert.ok(consistency.every((finding) => finding.evidence.every((item) => /^(backups|logs)\[\d+\]$/.test(item.source))));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const sensitiveValue of ["sensitive-backup", "/secret/a", "/secret/b", "/private/app.log"]) {
    assert.equal(json.includes(sensitiveValue), false);
    assert.equal(html.includes(sensitiveValue), false);
  }
  assert.ok(report.limitations.some((item) => item.includes("Backup/log consistency findings")));
});

test("canonical reports deduplicate overlapping legacy and backup/log consistency evidence", () => {
  const consistency = consistencyFindings(overlappingSnapshot());

  assert.equal(consistency.length, 2);
  assert.deepEqual(consistency.map((finding) => finding.title).sort(), [
    "Backup inventory reports conflicting metadata",
    "Log inventory reports conflicting metadata",
  ]);
  assert.equal(new Set(consistency.map((finding) => [
    finding.category,
    finding.title,
    ...finding.evidence.map((item) => item.source).sort(),
  ].join("\u001f"))).size, 2);
});
