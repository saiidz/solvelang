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

test("canonical reports preserve partial load-vector uncertainty without exposing values", () => {
  const report = createServerAuditReport({
    schemaVersion: "1",
    collectedAt: "2026-08-21T03:17:00.000Z",
    host: { hostname: "audit-host" },
    system: {
      uptimeSeconds: 7200,
      load: [0.91, 0.73],
      memoryTotalBytes: 8192,
      memoryAvailableBytes: 4096,
    },
    metadata: { redactionsApplied: true },
  }, "2026-08-21T03:18:00.000Z");

  const finding = report.findings.find(
    (candidate) => candidate.title === "System telemetry evidence is incomplete",
  );
  assert.deepEqual(finding?.evidence, [
    { source: "system.load", summary: "load vector incomplete" },
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const suppliedMetricValue of ["7200", "0.91", "0.73", "8192", "4096"]) {
    assert.equal(json.includes(suppliedMetricValue), false);
    assert.equal(html.includes(suppliedMetricValue), false);
  }
});
