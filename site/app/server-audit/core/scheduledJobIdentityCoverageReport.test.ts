import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithBlankScheduledJobIdentities(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T01:35:00.000Z",
    host: { hostname: "audit-host" },
    scheduledJobs: [
      { source: "   ", schedule: "0 * * * *", commandSummary: "private-command-a" },
      { source: "/private/cron/source", schedule: "*/5 * * * *", commandSummary: "\t" },
      { source: "cron.daily", schedule: "daily", commandSummary: "private-command-b" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose scheduled-job identity coverage with structural evidence only", () => {
  const report = createServerAuditReport(snapshotWithBlankScheduledJobIdentities(), "2026-08-21T01:36:00.000Z");

  const source = report.findings.filter((finding) => finding.title === "Scheduled-job record lacks a usable source identity");
  const command = report.findings.filter((finding) => finding.title === "Scheduled-job record lacks a usable command identity");

  assert.equal(source.length, 1);
  assert.equal(command.length, 1);
  assert.deepEqual(source[0].evidence, [{
    source: "scheduledJobs[0].source",
    summary: "scheduled-job source identity is empty after normalization",
  }]);
  assert.deepEqual(command[0].evidence, [{
    source: "scheduledJobs[1].commandSummary",
    summary: "scheduled-job command identity is empty after normalization",
  }]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of [
    "private-command-a",
    "private-command-b",
    "/private/cron/source",
    "0 * * * *",
    "*/5 * * * *",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  assert.ok(json.includes("scheduledJobs[0].source"));
  assert.ok(json.includes("scheduledJobs[1].commandSummary"));
  assert.ok(html.includes("scheduledJobs[0].source"));
  assert.ok(html.includes("scheduledJobs[1].commandSummary"));
  assert.ok(report.limitations.some((item) => item.includes("Scheduled-job identity coverage findings")));
});
