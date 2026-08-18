import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditArtifactFindings } from "./artifactFindings";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T15:00:00.000Z",
    host: { hostname: "audit-host" },
    backups: [
      { name: "secret-a", path: "/srv/private/backup.tar", ageHours: 1, sizeBytes: 100 },
      { name: "secret-b", path: "/srv/private/backup.tar", ageHours: 2, sizeBytes: 200 },
    ],
    logs: [
      { path: "/var/log/private.log", sizeBytes: 10, modifiedAt: "2026-08-18T14:00:00.000Z" },
      { path: "/var/log/private.log", sizeBytes: 20, modifiedAt: "2026-08-18T14:01:00.000Z" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("artifact findings map contradictions to structural redacted evidence", () => {
  const findings = createServerAuditArtifactFindings(snapshot());
  assert.deepEqual(
    findings.map((finding) => finding.title).sort(),
    ["Backup inventory reports conflicting metadata", "Log inventory reports conflicting metadata"].sort(),
  );

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("secret-a"), false);
  assert.equal(serialized.includes("/srv/private/backup.tar"), false);
  assert.equal(serialized.includes("/var/log/private.log"), false);
  assert.ok(serialized.includes("backups[0]"));
  assert.ok(serialized.includes("logs[0]"));
});

test("server report includes artifact integrity findings without leaking artifact identifiers", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-18T15:05:00.000Z");
  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);

  assert.ok(report.findings.some((finding) => finding.title === "Backup inventory reports conflicting metadata"));
  assert.ok(report.findings.some((finding) => finding.title === "Log inventory reports conflicting metadata"));
  assert.ok(report.limitations.some((limitation) => limitation.includes("Backup/log consistency")));
  assert.equal(json.includes("/srv/private/backup.tar"), false);
  assert.equal(html.includes("/var/log/private.log"), false);
});
