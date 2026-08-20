import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithCertificate(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T13:00:00.000Z",
    host: { hostname: "audit-host" },
    web: {
      certificates: [{ name: "private-expiry-gap.example.internal" }],
    },
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose missing certificate expiry evidence without certificate identity leakage", () => {
  const report = createServerAuditReport(snapshotWithCertificate(), "2026-08-20T13:01:00.000Z");
  const coverage = report.findings.filter((finding) => finding.title === "TLS certificate record lacks expiry evidence");

  assert.equal(coverage.length, 1);
  assert.equal(coverage[0].category, "coverage");
  assert.deepEqual(coverage[0].evidence, [{
    source: "web.certificates[0]",
    summary: "certificate record has no supplied expiry evidence",
  }]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.equal(json.includes("private-expiry-gap.example.internal"), false);
  assert.equal(html.includes("private-expiry-gap.example.internal"), false);
  assert.ok(report.limitations.some((item) => item.includes("Certificate-coverage findings")));
});
