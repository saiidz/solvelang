import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

const SERVICE_COVERAGE_LIMITATION =
  "Service-coverage findings report only an explicit empty service inventory; they do not prove service discovery completeness, boot enablement, runtime health, or collector authority.";

function snapshot(services: NonNullable<ServerAuditSnapshot["services"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T15:40:00.000Z",
    host: { hostname: "audit-host" },
    services,
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose explicit empty service coverage with structural evidence", () => {
  const report = createServerAuditReport(snapshot([]), "2026-08-20T15:41:00.000Z");
  const finding = report.findings.find((item) => item.title === "No service records supplied");

  assert.ok(finding);
  assert.equal(finding.category, "coverage");
  assert.deepEqual(finding.evidence, [{ source: "services", summary: "0 service records" }]);
  assert.ok(report.limitations.includes(SERVICE_COVERAGE_LIMITATION));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.ok(json.includes("No service records supplied"));
  assert.ok(html.includes("No service records supplied"));
  assert.ok(json.includes(SERVICE_COVERAGE_LIMITATION));
  assert.ok(html.includes(SERVICE_COVERAGE_LIMITATION));
});

test("canonical reports do not add service coverage findings for a non-empty collector-style inventory", () => {
  const report = createServerAuditReport(snapshot([
    { name: "private-customer-worker.service", state: "active running" },
  ]), "2026-08-20T15:41:00.000Z");

  assert.equal(report.findings.some((item) => item.title === "No service records supplied"), false);
  assert.ok(report.limitations.includes(SERVICE_COVERAGE_LIMITATION));
});
