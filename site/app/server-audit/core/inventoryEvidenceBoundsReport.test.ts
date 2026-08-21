import assert from "node:assert/strict";
import test from "node:test";

import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T08:30:00.000Z",
    host: { hostname: "audit-host" },
    packages: Array.from({ length: 40 }, (_, index) => ({
      name: "private-inventory-package",
      version: index % 2 === 0 ? "private-version-a" : "private-version-b",
    })),
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports preserve bounded inventory evidence and explicit cardinality truth", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-21T08:31:00.000Z");
  const finding = report.findings.find(
    (candidate) => candidate.title === "Package inventory reports conflicting versions",
  );

  assert.ok(finding);
  assert.equal(finding.evidence.length, 32);
  assert.deepEqual(
    finding.evidence.map((item) => item.source),
    Array.from({ length: 32 }, (_, index) => `packages[${index}]`),
  );
  assert.ok(finding.summary.includes("bounded to 32 of 40 affected records"));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const value of [
    "Package inventory reports conflicting versions",
    "bounded to 32 of 40 affected records",
    "packages[0]",
    "packages[31]",
  ]) {
    assert.ok(json.includes(value));
    assert.ok(html.includes(value));
  }

  for (const privateValue of [
    "private-inventory-package",
    "private-version-a",
    "private-version-b",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  assert.equal(json.includes("packages[32]"), false);
  assert.equal(html.includes("packages[32]"), false);
});
