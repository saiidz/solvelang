import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T06:30:00.000Z",
    host: { hostname: "audit-host" },
    services: [
      {
        name: "private-complete.service",
        state: "active running",
        enabled: "private-enabled",
      },
      {
        name: "private-missing-state.service",
        state: "   ",
        enabled: "private-disabled",
      },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose service state coverage with structural evidence only", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-21T06:31:00.000Z");
  const finding = report.findings.find(
    (candidate) => candidate.title === "Service record lacks usable state evidence",
  );

  assert.ok(finding);
  assert.equal(finding.severity, "info");
  assert.equal(finding.category, "coverage");
  assert.deepEqual(finding.evidence, [
    { source: "services[1].state", summary: "service state is empty after normalization" },
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of [
    "private-complete.service",
    "private-missing-state.service",
    "active running",
    "private-enabled",
    "private-disabled",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  assert.ok(json.includes("services[1].state"));
  assert.ok(html.includes("services[1].state"));
  assert.ok(report.limitations.some((item) => item.includes("Service-state coverage findings report only supplied service records")));
});
