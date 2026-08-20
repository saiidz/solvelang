import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

const CONFIGURATION_RISK_TITLES = new Set([
  "Root SSH login is not disabled",
  "SSH password authentication remains enabled",
  "Host firewall not reported active",
  "Automatic security updates not confirmed",
]);

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T17:20:00.000Z",
    host: { hostname: "audit-host" },
    security: {
      firewall: "N/A",
      automaticUpdates: "not applicable",
      rootSshLogin: "not-applicable",
      passwordSshLogin: "not available",
      selinux: "unavailable",
      apparmor: "not collected",
    },
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports preserve unknown security probes as structural coverage evidence", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-20T17:21:00.000Z");

  for (const finding of report.findings) {
    assert.equal(CONFIGURATION_RISK_TITLES.has(finding.title), false);
  }

  const coverage = report.findings.find((finding) => finding.title === "Security posture probes are inconclusive");
  assert.ok(coverage);
  assert.equal(coverage.severity, "info");
  assert.equal(coverage.category, "coverage");
  assert.deepEqual(coverage.evidence, [
    { source: "security.firewall", summary: "value unavailable or unknown" },
    { source: "security.automaticUpdates", summary: "value unavailable or unknown" },
    { source: "security.rootSshLogin", summary: "value unavailable or unknown" },
    { source: "security.passwordSshLogin", summary: "value unavailable or unknown" },
    { source: "security.selinux", summary: "value unavailable or unknown" },
    { source: "security.apparmor", summary: "value unavailable or unknown" },
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.ok(json.includes("Security posture probes are inconclusive"));
  assert.ok(html.includes("Security posture probes are inconclusive"));

  for (const rawSentinel of ["N/A", "not applicable", "not-applicable", "not available", "unavailable", "not collected"]) {
    assert.equal(json.includes(rawSentinel), false);
    assert.equal(html.includes(rawSentinel), false);
  }
});
