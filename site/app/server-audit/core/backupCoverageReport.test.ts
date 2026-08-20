import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T14:00:00.000Z",
    host: { hostname: "audit-host" },
    backups: [
      {
        name: "private-customer-backup-age",
        path: "/backups/private-customer-backup-age",
        sizeBytes: 1024,
      },
      {
        name: "private-customer-backup-size",
        path: "/backups/private-customer-backup-size",
        ageHours: 8,
      },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose missing backup freshness and size evidence without backup identity leakage", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-20T14:01:00.000Z");
  const freshness = report.findings.find((item) => item.title === "Backup record lacks freshness evidence");
  const size = report.findings.find((item) => item.title === "Backup record lacks size evidence");

  assert.ok(freshness);
  assert.ok(size);
  assert.equal(freshness.category, "coverage");
  assert.equal(size.category, "coverage");
  assert.deepEqual(freshness.evidence, [{ source: "backups[0].ageHours", summary: "freshness evidence is absent" }]);
  assert.deepEqual(size.evidence, [{ source: "backups[1].sizeBytes", summary: "size evidence is absent" }]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of [
    "private-customer-backup-age",
    "/backups/private-customer-backup-age",
    "private-customer-backup-size",
    "/backups/private-customer-backup-size",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }
  assert.ok(report.limitations.includes(
    "Backup-coverage findings report only supplied backup records that lack ageHours or sizeBytes evidence; they do not prove backup failure, freshness, artifact completeness, restoreability, or complete backup discovery.",
  ));
});
