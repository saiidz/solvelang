import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T06:00:00.000Z",
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
        mount: "/private-incomplete",
        filesystem: "private-device-incomplete",
        usagePercent: 25,
      },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose filesystem byte-accounting coverage with structural evidence only", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-21T06:01:00.000Z");
  const finding = report.findings.find(
    (candidate) => candidate.title === "Filesystem byte-accounting evidence is incomplete",
  );

  assert.ok(finding);
  assert.equal(finding.severity, "info");
  assert.equal(finding.category, "coverage");
  assert.deepEqual(finding.evidence, [
    { source: "filesystems[1].sizeBytes", summary: "sizeBytes missing" },
    { source: "filesystems[1].usedBytes", summary: "usedBytes missing" },
    { source: "filesystems[1].availableBytes", summary: "availableBytes missing" },
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of [
    "/private-complete",
    "/private-incomplete",
    "private-device-complete",
    "private-device-incomplete",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  for (const source of [
    "filesystems[1].sizeBytes",
    "filesystems[1].usedBytes",
    "filesystems[1].availableBytes",
  ]) {
    assert.ok(json.includes(source));
    assert.ok(html.includes(source));
  }
  assert.ok(report.limitations.some((item) => item.includes("Filesystem byte-accounting coverage findings report only supplied filesystem records")));
});
