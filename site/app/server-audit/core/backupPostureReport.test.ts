import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T13:00:00.000Z",
    host: { hostname: "audit-host" },
    backups: [{
      name: "private-customer-backup.tar",
      path: "/backups/private-customer-backup.tar",
      ageHours: 100,
      sizeBytes: 0,
    }],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose bounded backup posture findings without backup identity leakage", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-20T13:01:00.000Z");
  const posture = report.findings.filter((finding) => finding.category === "backup");

  assert.deepEqual(
    posture.map((finding) => finding.title).sort(),
    [
      "Backup evidence is older than the configured freshness threshold",
      "Backup evidence reports a zero-byte file",
    ].sort(),
  );
  assert.deepEqual(
    posture.flatMap((finding) => finding.evidence.map((item) => item.source)).sort(),
    ["backups[0].ageHours", "backups[0].sizeBytes"],
  );

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.equal(json.includes("private-customer-backup.tar"), false);
  assert.equal(html.includes("private-customer-backup.tar"), false);
  assert.equal(json.includes("/backups/private-customer-backup.tar"), false);
  assert.equal(html.includes("/backups/private-customer-backup.tar"), false);
  assert.ok(report.limitations.some((item) => item.includes("Backup-posture findings")));
});
