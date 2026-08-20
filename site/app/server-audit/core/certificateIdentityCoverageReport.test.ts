import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithBlankCertificateIdentity(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T13:00:00.000Z",
    host: { hostname: "audit-host" },
    web: {
      certificates: [
        { name: "   ", notAfter: "2026-09-01T00:00:00.000Z", daysRemaining: 12 },
        { name: "private-valid.example.internal", notAfter: "2026-09-10T00:00:00.000Z", daysRemaining: 21 },
      ],
    },
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose unusable certificate identity coverage with structural evidence only", () => {
  const report = createServerAuditReport(snapshotWithBlankCertificateIdentity(), "2026-08-20T13:01:00.000Z");
  const coverage = report.findings.filter((finding) => finding.title === "TLS certificate record lacks a usable identity");

  assert.equal(coverage.length, 1);
  assert.equal(coverage[0].category, "coverage");
  assert.deepEqual(coverage[0].evidence, [{
    source: "web.certificates[0].name",
    summary: "certificate identity is empty after normalization",
  }]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.equal(json.includes("private-valid.example.internal"), false);
  assert.equal(html.includes("private-valid.example.internal"), false);
  assert.equal(json.includes("2026-09-10"), false);
  assert.equal(html.includes("2026-09-10"), false);
  assert.ok(report.limitations.some((item) => item.includes("Certificate-identity coverage findings")));
});
