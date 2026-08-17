import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport } from "./report";
import type { ServerAuditSnapshot } from "./types";

function inconsistentSnapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-15T05:00:00.000Z",
    host: { hostname: "audit-host" },
    web: {
      certificates: [
        {
          name: "private-admin.internal.example",
          notAfter: "not-a-timestamp",
          daysRemaining: 20,
        },
      ],
    },
    logs: [
      {
        path: "/srv/private/customer-a/application.log",
        modifiedAt: "2026-08-15T05:11:00.000Z",
      },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("Server Audit report composes bounded temporal consistency evidence without raw names or paths", () => {
  const report = createServerAuditReport(inconsistentSnapshot(), "2026-08-15T06:00:00.000Z");
  const temporal = report.findings.filter((finding) => finding.category === "evidence-integrity");

  assert.deepEqual(
    temporal.map((finding) => finding.title).sort(),
    [
      "Certificate expiry timestamp is invalid",
      "Log timestamp exceeds snapshot collection time",
    ].sort(),
  );
  assert.ok(temporal.every((finding) => /^srv_[a-f0-9]{8}$/.test(finding.id)));

  const serialized = JSON.stringify(temporal);
  assert.equal(serialized.includes("private-admin.internal.example"), false);
  assert.equal(serialized.includes("/srv/private/customer-a/application.log"), false);
  assert.ok(serialized.includes("web.certificates[0].notAfter"));
  assert.ok(serialized.includes("logs[0].modifiedAt"));
});

test("temporal report integration stays deterministic across generation timestamps", () => {
  const first = createServerAuditReport(inconsistentSnapshot(), "2026-08-15T06:00:00.000Z");
  const second = createServerAuditReport(inconsistentSnapshot(), "2026-08-15T07:00:00.000Z");

  assert.equal(first.reportId, second.reportId);
  assert.deepEqual(
    first.findings.map((finding) => finding.id),
    second.findings.map((finding) => finding.id),
  );
  assert.ok(first.limitations.some((item) => item.includes("Timestamp-integrity")));
});
