import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function baseSnapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T13:00:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports include incomplete public-file coverage with structural redacted evidence", () => {
  const snapshot = baseSnapshot();
  snapshot.web = {
    roots: [{ path: "/private/customer-root" }],
    publicFileChecks: [
      { rootIndex: 0, marker: "env-file", present: false },
      { rootIndex: 0, marker: "git-config", present: false },
    ],
  };

  const report = createServerAuditReport(snapshot, "2026-08-20T13:01:00.000Z");
  const findings = report.findings.filter((finding) => finding.title === "Candidate web root has incomplete sensitive-file marker coverage");

  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "coverage");
  assert.deepEqual(findings[0].evidence.map((item) => item.source), ["web.roots[0]", "web.roots[0]"]);
  assert.deepEqual(findings[0].evidence.map((item) => item.summary).sort(), ["composer-auth check absent", "npmrc check absent"]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.equal(json.includes("/private/customer-root"), false);
  assert.equal(html.includes("/private/customer-root"), false);
  assert.ok(report.limitations.some((item) => item.includes("Public-file coverage findings")));
});

test("canonical reports include contradictory public-file coverage evidence once", () => {
  const snapshot = baseSnapshot();
  snapshot.web = {
    roots: [{ path: "/private/customer-root" }],
    publicFileChecks: [
      { rootIndex: 0, marker: "env-file", present: false },
      { rootIndex: 0, marker: "git-config", present: false },
      { rootIndex: 0, marker: "npmrc", present: false },
      { rootIndex: 0, marker: "composer-auth", present: false },
      { rootIndex: 0, marker: "env-file", present: true },
    ],
  };

  const report = createServerAuditReport(snapshot, "2026-08-20T13:01:00.000Z");
  const findings = report.findings.filter((finding) => finding.title === "Sensitive-file marker checks contradict each other");

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "low");
  assert.equal(findings[0].category, "evidence-integrity");
  assert.deepEqual(findings[0].evidence.map((item) => item.source), [
    "web.publicFileChecks[0].present",
    "web.publicFileChecks[4].present",
  ]);
  assert.equal(JSON.stringify(findings).includes("/private/customer-root"), false);
});

test("canonical reports keep unavailable-root reference integrity authoritative", () => {
  const snapshot = baseSnapshot();
  snapshot.web = {
    roots: Array<{ path: string }>(1),
    publicFileChecks: [{ rootIndex: 0, marker: "env-file", present: true }],
  };

  const report = createServerAuditReport(snapshot, "2026-08-20T13:01:00.000Z");
  assert.equal(report.findings.filter((finding) => finding.title === "Public-file marker check references an unavailable web root").length, 1);
  assert.equal(report.findings.filter((finding) => finding.title === "Candidate web root has incomplete sensitive-file marker coverage").length, 0);
  assert.equal(report.findings.filter((finding) => finding.title === "Sensitive-file marker checks contradict each other").length, 0);
  assert.equal(report.findings.some((finding) => finding.category === "web-exposure"), false);
});
