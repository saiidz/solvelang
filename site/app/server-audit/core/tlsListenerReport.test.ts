import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithTlsListenerMismatch(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T01:50:00.000Z",
    host: { hostname: "audit-host" },
    listeningSockets: [
      { protocol: "tcp", localAddress: "127.0.0.1", port: 8443, process: "private-proxy" },
    ],
    web: {
      certificates: [
        { name: "private.example", notAfter: "2026-12-01T00:00:00Z", daysRemaining: 100 },
      ],
    },
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose TLS listener consistency with structural evidence only", () => {
  const report = createServerAuditReport(snapshotWithTlsListenerMismatch(), "2026-08-21T01:51:00.000Z");
  const findings = report.findings.filter((finding) => finding.title === "TLS certificate evidence lacks a conventional local TLS listener");

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].evidence, [
    { source: "web.certificates", summary: "1 TLS certificate record observed" },
    { source: "listeningSockets", summary: "no collected TCP listener on port 443" },
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of ["private.example", "127.0.0.1", "private-proxy"]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  assert.ok(json.includes("web.certificates"));
  assert.ok(json.includes("listeningSockets"));
  assert.ok(html.includes("web.certificates"));
  assert.ok(html.includes("listeningSockets"));
  assert.ok(report.limitations.some((item) => item.includes("TLS-listener consistency findings")));
});
