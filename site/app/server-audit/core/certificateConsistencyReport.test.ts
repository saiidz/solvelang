import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithCertificates(certificates: NonNullable<NonNullable<ServerAuditSnapshot["web"]>["certificates"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T17:00:00.000Z",
    host: { hostname: "audit-host" },
    web: { certificates },
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose certificate consistency findings with structural redacted evidence", () => {
  const privateName = "private-admin.example.internal";
  const report = createServerAuditReport(snapshotWithCertificates([
    { name: privateName, notAfter: "2026-09-01T00:00:00.000Z", daysRemaining: 14 },
    { name: privateName.toUpperCase(), notAfter: "2026-09-08T00:00:00.000Z", daysRemaining: 21 },
  ]), "2026-08-18T17:01:00.000Z");

  const consistency = report.findings.filter((finding) => finding.title.startsWith("Duplicate certificate identity"));
  assert.equal(consistency.length, 2);
  assert.ok(consistency.every((finding) => finding.category === "evidence-integrity"));
  assert.deepEqual(
    consistency.flatMap((finding) => finding.evidence.map((item) => item.source)).sort(),
    [
      "web.certificates[0].daysRemaining",
      "web.certificates[0].notAfter",
      "web.certificates[1].daysRemaining",
      "web.certificates[1].notAfter",
    ],
  );

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.equal(json.includes(privateName), false);
  assert.equal(html.includes(privateName), false);
  assert.ok(report.limitations.some((item) => item.includes("Certificate-consistency findings")));
});
