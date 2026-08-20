import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditCertificateExpiryFallbackFindings } from "./certificateExpiryFindings";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T12:00:00.000Z",
    host: { hostname: "audit-host" },
    web: {
      certificates: [
        { name: "private-expired.example", notAfter: "2026-08-19T12:00:00.000Z" },
        { name: "private-seven.example", notAfter: "2026-08-25T12:00:00.000Z" },
        { name: "private-thirty.example", notAfter: "2026-09-09T12:00:00.000Z" },
        { name: "private-future.example", notAfter: "2026-10-20T12:00:00.000Z" },
        { name: "collector-days.example", notAfter: "2026-08-21T12:00:00.000Z", daysRemaining: 1 },
        { name: "invalid.example", notAfter: "not-a-timestamp" },
      ],
    },
    metadata: { redactionsApplied: true },
  };
}

test("certificate expiry fallback derives bounded posture only when daysRemaining is absent", () => {
  const findings = createServerAuditCertificateExpiryFallbackFindings(snapshot());

  assert.deepEqual(findings.map((finding) => [finding.severity, finding.title]), [
    ["critical", "TLS certificate expired"],
    ["high", "TLS certificate expires within seven days"],
    ["medium", "TLS certificate approaching expiry"],
  ]);
  assert.deepEqual(findings.map((finding) => finding.evidence[0]?.source), [
    "web.certificates[0].notAfter",
    "web.certificates[1].notAfter",
    "web.certificates[2].notAfter",
  ]);

  const serialized = JSON.stringify(findings);
  for (const hidden of [
    "private-expired.example",
    "private-seven.example",
    "private-thirty.example",
    "collector-days.example",
    "invalid.example",
  ]) {
    assert.equal(serialized.includes(hidden), false);
  }
});

test("certificate expiry fallback is deterministic and truncates with explicit coverage truth", () => {
  const input = snapshot();
  input.web!.certificates = Array.from({ length: 120 }, (_, index) => ({
    name: `private-${index}.example`,
    notAfter: "2026-08-21T12:00:00.000Z",
  }));

  const first = createServerAuditCertificateExpiryFallbackFindings(input);
  const second = createServerAuditCertificateExpiryFallbackFindings(input);

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  assert.equal(first.filter((finding) => finding.category === "coverage").length, 1);
  assert.ok(first.some((finding) => finding.title === "Certificate expiry fallback findings were truncated"));
  assert.ok(first.every((finding) => /^srv_[a-f0-9]{8}$/.test(finding.id)));
});

test("canonical reports include structural certificate expiry fallback without certificate identities", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-20T12:01:00.000Z");
  const fallback = report.findings.filter((finding) => finding.evidence.some((item) => item.summary.includes("derived from notAfter")));

  assert.equal(fallback.length, 3);
  assert.deepEqual(fallback.map((finding) => finding.title).sort(), [
    "TLS certificate approaching expiry",
    "TLS certificate expired",
    "TLS certificate expires within seven days",
  ]);
  assert.ok(report.limitations.some((item) => item.includes("Certificate-expiry fallback")));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const hidden of ["private-expired.example", "private-seven.example", "private-thirty.example"]) {
    assert.equal(json.includes(hidden), false);
    assert.equal(html.includes(hidden), false);
  }
});
