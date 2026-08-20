import assert from "node:assert/strict";
import test from "node:test";

import { createServerAuditScheduledJobRelationshipFindings } from "./scheduledJobRelationshipFindings";
import { analyzeServerAuditScheduledJobRelationships } from "./scheduledJobRelationships";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T21:10:00.000Z",
    host: { hostname: "audit-host" },
    services: [
      { name: "shared.service", state: "active" },
      { name: "shared.service", state: "active" },
    ],
    scheduledJobs: [
      { source: "timer-a", commandSummary: "shared.service" },
      { source: "timer-b", commandSummary: "shared.service" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("scheduled-job analysis preserves exact multi-target job counts when output is truncated", () => {
  const result = analyzeServerAuditScheduledJobRelationships(snapshot(), { maxRelationships: 1 });

  assert.equal(result.summary.relationshipsObserved, 4);
  assert.equal(result.summary.jobsWithRelationships, 2);
  assert.equal(result.summary.jobsWithMultipleRelationships, 2);
  assert.equal(result.summary.jobsWithPartiallyMaterializedMultipleRelationships, 2);
  assert.equal(result.relationships.length, 1);
  assert.equal(result.execution.relationshipsTruncated, true);
});

test("scheduled-job analysis counts partially materialized fanout even when multi-target status remains visible", () => {
  const input = snapshot();
  input.services = [
    { name: "shared.service", state: "active" },
    { name: "shared.service", state: "active" },
    { name: "shared.service", state: "active" },
  ];
  input.scheduledJobs = [{ source: "timer-a", commandSummary: "shared.service" }];

  const result = analyzeServerAuditScheduledJobRelationships(input, { maxRelationships: 2 });

  assert.equal(result.summary.relationshipsObserved, 3);
  assert.equal(result.summary.jobsWithMultipleRelationships, 1);
  assert.equal(result.summary.jobsWithPartiallyMaterializedMultipleRelationships, 1);
  assert.equal(result.relationships.length, 2);
  assert.equal(result.execution.relationshipsTruncated, true);
});

test("scheduled-job findings surface hidden multi-target classification without leaking labels", () => {
  const findings = createServerAuditScheduledJobRelationshipFindings(snapshot(), { maxRelationships: 1 });
  const hiddenFanout = findings.find(
    (finding) => finding.title === "Some multi-target scheduled-job mappings are not fully materialized",
  );

  assert.ok(hiddenFanout);
  assert.equal(hiddenFanout.severity, "info");
  assert.deepEqual(hiddenFanout.evidence, [
    { source: "scheduledJobRelationships.summary.jobsWithMultipleRelationships", summary: "2" },
    { source: "scheduledJobRelationships.output.emittedMultiTargetJobs", summary: "0" },
    {
      source: "scheduledJobRelationships.summary.jobsWithPartiallyMaterializedMultipleRelationships",
      summary: "2",
    },
  ]);

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("shared.service"), false);
  assert.equal(serialized.includes("timer-a"), false);
  assert.equal(serialized.includes("timer-b"), false);
});
