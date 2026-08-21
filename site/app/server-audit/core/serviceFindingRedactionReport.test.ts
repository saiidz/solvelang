import assert from "node:assert/strict";
import test from "node:test";
import { analyzeServerSnapshot } from "./analyze";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T07:50:00.000Z",
    host: { hostname: "audit-host" },
    services: [{
      name: "private-failed-worker.service",
      state: "failed private-state-token",
      enabled: "private-enablement-token",
    }],
    metadata: { redactionsApplied: true },
  };
}

test("service health findings use structural evidence only", () => {
  const findings = analyzeServerSnapshot(snapshot()).filter((finding) => finding.title === "Service is not healthy");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "medium");
  assert.deepEqual(findings[0]!.evidence, [{
    source: "services[0].state",
    summary: "service state contains explicit failed or error token",
  }]);

  const serialized = JSON.stringify(findings);
  for (const privateValue of [
    "private-failed-worker.service",
    "private-state-token",
    "private-enablement-token",
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("canonical reports keep failed-service evidence structural and redacted", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-21T07:51:00.000Z");
  assert.ok(report.findings.some((finding) => finding.title === "Service is not healthy"));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of [
    "private-failed-worker.service",
    "private-state-token",
    "private-enablement-token",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  assert.ok(json.includes("services[0].state"));
  assert.ok(html.includes("services[0].state"));
});
