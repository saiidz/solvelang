import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T05:35:00.000Z",
    host: { hostname: "audit-host" },
    filesystems: [
      { mount: "/private-critical", filesystem: "private-device-critical", usagePercent: 96 },
      { mount: "/private-high", filesystem: "private-device-high", usagePercent: 91 },
      { mount: "/private-medium", filesystem: "private-device-medium", usagePercent: 81 },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports replace raw filesystem usage findings with structural evidence", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-21T05:36:00.000Z");
  const findings = report.findings.filter((finding) => finding.category === "storage");

  assert.deepEqual(findings.map((finding) => finding.title), [
    "Filesystem critically full",
    "Filesystem nearly full",
    "Filesystem usage elevated",
  ]);
  assert.deepEqual(findings.map((finding) => finding.evidence), [
    [{ source: "filesystems[0].usagePercent", summary: "96% used" }],
    [{ source: "filesystems[1].usagePercent", summary: "91% used" }],
    [{ source: "filesystems[2].usagePercent", summary: "81% used" }],
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of [
    "/private-critical",
    "/private-high",
    "/private-medium",
    "private-device-critical",
    "private-device-high",
    "private-device-medium",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  assert.ok(json.includes("filesystems[0].usagePercent"));
  assert.ok(html.includes("filesystems[0].usagePercent"));
  assert.ok(report.limitations.some((item) => item.includes("Filesystem-usage findings compare only supplied usagePercent")));
});
