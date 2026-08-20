import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T14:00:00.000Z",
    host: { hostname: "audit-host" },
    backups: [{
      name: "private-customer-backup",
      path: "/backups/private-customer-backup",
      sizeBytes: 1024,
    }],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose missing backup age evidence without backup identity leakage", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-20T14:01:00.000Z");
  const finding = report.findings.find((item) => item.title === "Backup record lacks freshness evidence");

  assert.ok(finding);
  assert.equal(finding.category, "coverage");
  assert.deepEqual(finding.evidence, [{ source: "backups[0].ageHours", summary: "freshness evidence is absent" }]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.equal(json.includes("private-customer-backup"), false);
  assert.equal(html.includes("private-customer-backup"), false);
  assert.equal(json.includes("/backups/private-customer-backup"), false);
  assert.equal(html.includes("/backups/private-customer-backup"), false);
  assert.ok(report.limitations.some((item) => item.includes("Backup-coverage findings")));
});
