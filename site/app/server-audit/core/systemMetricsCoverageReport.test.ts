import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithIncompleteSystemTelemetry(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T03:15:00.000Z",
    host: { hostname: "audit-host" },
    system: {
      uptimeSeconds: 3600,
      load: [0.01, 0.02, 0.03],
    },
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose incomplete system telemetry with structural evidence only", () => {
  const report = createServerAuditReport(
    snapshotWithIncompleteSystemTelemetry(),
    "2026-08-21T03:16:00.000Z",
  );
  const findings = report.findings.filter(
    (finding) => finding.title === "System telemetry evidence is incomplete",
  );

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].evidence, [
    { source: "system.memoryTotalBytes", summary: "metric missing" },
    { source: "system.memoryAvailableBytes", summary: "metric missing" },
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const suppliedMetricValue of ["3600", "0.01", "0.02", "0.03"]) {
    assert.equal(json.includes(suppliedMetricValue), false);
    assert.equal(html.includes(suppliedMetricValue), false);
  }

  assert.ok(report.limitations.some((item) => item.includes("System-telemetry coverage findings")));
});
