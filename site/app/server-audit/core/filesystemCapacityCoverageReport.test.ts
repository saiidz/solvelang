import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithMissingFilesystemUsage(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T02:30:00.000Z",
    host: { hostname: "audit-host" },
    filesystems: [
      { mount: "/srv/private-missing", filesystem: "/dev/private-missing" },
      { mount: "/srv/private-complete", filesystem: "/dev/private-complete", usagePercent: 42 },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose filesystem capacity coverage with structural evidence only", () => {
  const report = createServerAuditReport(snapshotWithMissingFilesystemUsage(), "2026-08-21T02:31:00.000Z");
  const findings = report.findings.filter((finding) => finding.title === "Filesystem usage evidence is incomplete");

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].evidence, [{
    source: "filesystems[0].usagePercent",
    summary: "usagePercent missing",
  }]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of [
    "/srv/private-missing",
    "/dev/private-missing",
    "/srv/private-complete",
    "/dev/private-complete",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  assert.ok(report.limitations.some((item) => item.includes("Filesystem-capacity coverage findings")));
});
