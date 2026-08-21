import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T07:25:00.000Z",
    host: { hostname: "audit-host" },
    services: [
      {
        name: "private-complete.service",
        state: "active running",
        enabled: "private-enabled",
      },
      {
        name: "private-missing-enablement.service",
        state: "inactive dead",
      },
      {
        name: "private-blank-enablement.service",
        state: "active exited",
        enabled: "   ",
      },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose service enablement coverage with structural evidence only", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-21T07:26:00.000Z");
  const findings = report.findings.filter(
    (candidate) => candidate.title === "Service record lacks usable enablement evidence",
  );

  assert.equal(findings.length, 2);
  assert.equal(findings.every((finding) => finding.severity === "info"), true);
  assert.equal(findings.every((finding) => finding.category === "coverage"), true);
  assert.deepEqual(findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source)).sort(), [
    "services[1].enabled",
    "services[2].enabled",
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of [
    "private-complete.service",
    "private-missing-enablement.service",
    "private-blank-enablement.service",
    "active running",
    "inactive dead",
    "active exited",
    "private-enabled",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  assert.ok(json.includes("services[1].enabled"));
  assert.ok(html.includes("services[2].enabled"));
  assert.ok(report.limitations.some((item) => item.includes("Service-enablement coverage findings report only supplied service records")));
});
