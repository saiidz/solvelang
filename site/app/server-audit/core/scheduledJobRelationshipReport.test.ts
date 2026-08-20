import assert from "node:assert/strict";
import test from "node:test";

import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

const SCHEDULED_JOB_RELATIONSHIP_LIMITATION =
  "Scheduled-job relationship findings use only bounded exact-name-token matches over supplied sanitized command summaries and service/process names; multi-target, unresolved, oversized, or truncated results are completeness/integrity signals and do not prove command execution, ownership, job validity, runtime health, or collector authority.";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T20:50:00.000Z",
    host: { hostname: "audit-host" },
    services: [{ name: "private-api.service", state: "active" }],
    processes: [{ pid: 10, ppid: 1, uid: 1000, state: "S", name: "private-api" }],
    scheduledJobs: [
      {
        source: "cron:/private/api",
        schedule: "*/5 * * * *",
        commandSummary: "private-api.service private-api",
      },
      {
        source: "cron:/private/unmatched",
        commandSummary: "unrelated-task --run",
      },
      {
        source: "cron:/private/oversized",
        commandSummary: "x".repeat(513),
      },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose scheduled-job relationship uncertainty with structural evidence", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-20T20:51:00.000Z");

  const multiple = report.findings.find(
    (finding) => finding.title === "Scheduled job maps to multiple collected targets",
  );
  const unresolved = report.findings.find(
    (finding) => finding.title === "Some scheduled jobs have no exact-name-token relationship",
  );
  const partial = report.findings.find(
    (finding) => finding.title === "Scheduled-job relationship analysis is partial",
  );

  assert.ok(multiple);
  assert.ok(unresolved);
  assert.ok(partial);
  assert.deepEqual(
    multiple.evidence.map((item) => item.source).sort(),
    ["processes[0]", "scheduledJobs[0]", "services[0]"].sort(),
  );
  assert.ok(report.limitations.includes(SCHEDULED_JOB_RELATIONSHIP_LIMITATION));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const text of [
    "Scheduled job maps to multiple collected targets",
    "Some scheduled jobs have no exact-name-token relationship",
    "Scheduled-job relationship analysis is partial",
    SCHEDULED_JOB_RELATIONSHIP_LIMITATION,
  ]) {
    assert.ok(json.includes(text));
    assert.ok(html.includes(text));
  }

  const relationshipFindings = report.findings.filter((finding) => [
    "Scheduled job maps to multiple collected targets",
    "Some scheduled jobs have no exact-name-token relationship",
    "Scheduled-job relationship analysis is partial",
  ].includes(finding.title));
  const serialized = JSON.stringify(relationshipFindings);
  for (const sensitive of [
    "private-api",
    "cron:/private/api",
    "cron:/private/unmatched",
    "cron:/private/oversized",
    "*/5 * * * *",
  ]) {
    assert.equal(serialized.includes(sensitive), false);
  }
});

test("canonical reports preserve partially materialized scheduled-job fanout truth", () => {
  const input: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T20:50:00.000Z",
    host: { hostname: "audit-host" },
    services: Array.from({ length: 1_001 }, () => ({ name: "private-shared.service", state: "active" })),
    scheduledJobs: [{
      source: "cron:/private/fanout",
      commandSummary: "private-shared.service",
    }],
    metadata: { redactionsApplied: true },
  };

  const report = createServerAuditReport(input, "2026-08-20T20:51:00.000Z");
  const fanout = report.findings.find(
    (finding) => finding.title === "Some multi-target scheduled-job mappings are not fully materialized",
  );

  assert.ok(fanout);
  assert.deepEqual(fanout.evidence, [
    { source: "scheduledJobRelationships.summary.jobsWithMultipleRelationships", summary: "1" },
    { source: "scheduledJobRelationships.output.emittedMultiTargetJobs", summary: "1" },
    {
      source: "scheduledJobRelationships.summary.jobsWithPartiallyMaterializedMultipleRelationships",
      summary: "1",
    },
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const text of [
    "Some multi-target scheduled-job mappings are not fully materialized",
    "scheduledJobRelationships.summary.jobsWithPartiallyMaterializedMultipleRelationships",
    SCHEDULED_JOB_RELATIONSHIP_LIMITATION,
  ]) {
    assert.ok(json.includes(text));
    assert.ok(html.includes(text));
  }
  for (const sensitive of ["private-shared.service", "cron:/private/fanout"]) {
    assert.equal(json.includes(sensitive), false);
    assert.equal(html.includes(sensitive), false);
  }
});

test("canonical reports do not add scheduled-job relationship uncertainty for a unique exact-name-token mapping", () => {
  const input: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T20:50:00.000Z",
    host: { hostname: "audit-host" },
    services: [{ name: "api.service", state: "active" }],
    scheduledJobs: [{ source: "timer", commandSummary: "api.service" }],
    metadata: { redactionsApplied: true },
  };

  const report = createServerAuditReport(input, "2026-08-20T20:51:00.000Z");
  const relationshipTitles = new Set([
    "Scheduled job maps to multiple collected targets",
    "Some scheduled jobs have no exact-name-token relationship",
    "Scheduled-job relationship analysis is partial",
  ]);

  assert.equal(report.findings.some((finding) => relationshipTitles.has(finding.title)), false);
  assert.ok(report.limitations.includes(SCHEDULED_JOB_RELATIONSHIP_LIMITATION));
});
