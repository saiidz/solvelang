import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

const SCHEDULED_JOB_COVERAGE_LIMITATION =
  "Scheduled-job coverage findings report only an explicit empty scheduled-job inventory; because the reviewed collector scans a fixed set of cron directories and missing, unreadable, or empty directories can all yield no records, they do not prove that the host has no scheduled jobs or that scheduled-job collection was complete or authoritative.";

function snapshot(scheduledJobs: NonNullable<ServerAuditSnapshot["scheduledJobs"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:34:00.000Z",
    host: { hostname: "audit-host" },
    scheduledJobs,
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose explicit empty scheduled-job coverage with structural evidence", () => {
  const report = createServerAuditReport(snapshot([]), "2026-08-20T16:35:00.000Z");
  const finding = report.findings.find((item) => item.title === "No scheduled-job records supplied");

  assert.ok(finding);
  assert.equal(finding.category, "coverage");
  assert.deepEqual(finding.evidence, [{ source: "scheduledJobs", summary: "0 scheduled-job records" }]);
  assert.ok(report.limitations.includes(SCHEDULED_JOB_COVERAGE_LIMITATION));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.ok(json.includes("No scheduled-job records supplied"));
  assert.ok(html.includes("No scheduled-job records supplied"));
  assert.ok(json.includes("Scheduled-job coverage findings report only an explicit empty scheduled-job inventory"));
  assert.ok(html.includes("Scheduled-job coverage findings report only an explicit empty scheduled-job inventory"));
  assert.equal(json.includes("private-job"), false);
  assert.equal(html.includes("private-job"), false);
  assert.equal(json.includes("/etc/cron"), false);
  assert.equal(html.includes("/etc/cron"), false);
});

test("canonical reports do not add scheduled-job coverage findings for a non-empty inventory", () => {
  const report = createServerAuditReport(snapshot([
    {
      source: "/etc/cron.daily/private-job",
      commandSummary: "command content intentionally not collected",
    },
  ]), "2026-08-20T16:35:00.000Z");

  assert.equal(report.findings.some((item) => item.title === "No scheduled-job records supplied"), false);
  assert.ok(report.limitations.includes(SCHEDULED_JOB_COVERAGE_LIMITATION));
});
