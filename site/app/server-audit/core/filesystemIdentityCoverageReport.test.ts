import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithBlankFilesystemIdentity(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T01:20:00.000Z",
    host: { hostname: "audit-host" },
    filesystems: [
      { mount: " \t ", filesystem: "private-filesystem-label", sizeBytes: 1024 },
      { mount: "/srv/private-valid", filesystem: "private-valid-filesystem", sizeBytes: 2048 },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose filesystem identity coverage with structural evidence only", () => {
  const report = createServerAuditReport(snapshotWithBlankFilesystemIdentity(), "2026-08-21T01:21:00.000Z");
  const findings = report.findings.filter((finding) => finding.title === "Filesystem record lacks a usable mount identity");

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].evidence, [{
    source: "filesystems[0].mount",
    summary: "filesystem mount identity is empty after normalization",
  }]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of ["private-filesystem-label", "private-valid-filesystem", "/srv/private-valid"]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  assert.ok(report.limitations.some((item) => item.includes("Filesystem-identity coverage findings")));
});
