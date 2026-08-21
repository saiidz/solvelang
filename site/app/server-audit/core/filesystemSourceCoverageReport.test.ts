import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T06:10:00.000Z",
    host: { hostname: "audit-host" },
    filesystems: [
      {
        mount: "/private-complete",
        filesystem: "private-device-complete",
        sizeBytes: 100,
        usedBytes: 40,
        availableBytes: 60,
        usagePercent: 40,
      },
      {
        mount: "/private-missing-source",
        sizeBytes: 100,
        usedBytes: 25,
        availableBytes: 75,
        usagePercent: 25,
      },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose filesystem source-identity coverage with structural evidence only", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-21T06:11:00.000Z");
  const finding = report.findings.find(
    (candidate) => candidate.title === "Filesystem source identity evidence is incomplete",
  );

  assert.ok(finding);
  assert.equal(finding.severity, "info");
  assert.equal(finding.category, "coverage");
  assert.deepEqual(finding.evidence, [
    { source: "filesystems[1].filesystem", summary: "filesystem source identity missing" },
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of [
    "/private-complete",
    "/private-missing-source",
    "private-device-complete",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  assert.ok(json.includes("filesystems[1].filesystem"));
  assert.ok(html.includes("filesystems[1].filesystem"));
  assert.ok(report.limitations.some((item) => item.includes("Filesystem-source coverage findings report only supplied filesystem records")));
});
