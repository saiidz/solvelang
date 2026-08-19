import assert from "node:assert/strict";
import test from "node:test";

import { analyzeServerAuditScheduledJobRelationships } from "./scheduledJobRelationships";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-19T00:00:00Z",
    host: { hostname: "example" },
    services: [
      { name: "nginx.service", state: "running" },
      { name: "postgresql.service", state: "running" },
    ],
    processes: [
      { pid: 101, ppid: 1, uid: 0, state: "S", name: "backup-agent" },
      { pid: 102, ppid: 1, uid: 0, state: "S", name: "nginx-helper" },
    ],
    scheduledJobs: [
      { source: "systemd.timer:nginx-reload", schedule: "daily", commandSummary: "systemctl reload nginx.service" },
      { source: "cron:/etc/cron.d/backup", schedule: "0 3 * * *", commandSummary: "backup-agent --run" },
      { source: "cron:/etc/cron.d/unrelated", commandSummary: "echo nginx-helper-extra" },
    ],
  };
}

test("maps only exact sanitized service and process name tokens", () => {
  const result = analyzeServerAuditScheduledJobRelationships(snapshot());

  assert.equal(result.schema, "solvelang.server-audit.scheduled-job-relationships.v0");
  assert.equal(result.status, "complete");
  assert.deepEqual(
    result.relationships.map((relationship) => [
      relationship.kind,
      relationship.jobSource,
      relationship.targetName,
      relationship.confidence,
    ]),
    [
      ["scheduled-job-service", "systemd.timer:nginx-reload", "nginx.service", "exact-name-token"],
      ["scheduled-job-process", "cron:/etc/cron.d/backup", "backup-agent", "exact-name-token"],
    ],
  );
  assert.equal(result.summary.jobsWithRelationships, 2);
  assert.equal(result.summary.unresolvedJobs, 1);
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
  assert.equal(result.execution.commandExecution, false);
});

test("recognizes a systemd service base name conservatively without substring matching", () => {
  const input = snapshot();
  input.scheduledJobs = [
    { source: "timer", commandSummary: "service nginx reload" },
    { source: "similar", commandSummary: "service nginx-proxy reload" },
  ];

  const result = analyzeServerAuditScheduledJobRelationships(input);
  assert.deepEqual(result.relationships.map((relationship) => relationship.jobSource), ["timer"]);
  assert.equal(result.relationships[0]?.targetName, "nginx.service");
});

test("propagates bounded and oversized-summary limitations as partial truth", () => {
  const input = snapshot();
  input.scheduledJobs = [
    { source: "too-long", commandSummary: "x".repeat(20) },
    { source: "match", commandSummary: "nginx.service" },
    { source: "truncated-job", commandSummary: "backup-agent" },
  ];

  const result = analyzeServerAuditScheduledJobRelationships(input, {
    maxJobs: 2,
    maxTargets: 1,
    maxRelationships: 1,
    maxCommandSummaryCharacters: 10,
  });

  assert.equal(result.status, "partial");
  assert.equal(result.execution.jobsTruncated, true);
  assert.equal(result.execution.targetsTruncated, true);
  assert.equal(result.execution.oversizedCommandSummariesSkipped, 1);
  assert.equal(result.relationships.length, 1);
  assert.equal(result.summary.jobsAnalyzed, 1);
});

test("is deterministic and fails closed on invalid bounds", () => {
  const first = analyzeServerAuditScheduledJobRelationships(snapshot());
  const second = analyzeServerAuditScheduledJobRelationships(structuredClone(snapshot()));
  assert.deepEqual(first, second);

  assert.throws(
    () => analyzeServerAuditScheduledJobRelationships(snapshot(), { maxJobs: 0 }),
    /maxJobs must be an integer from 1 through 5000/,
  );
  assert.throws(
    () => analyzeServerAuditScheduledJobRelationships(snapshot(), { maxRelationships: 10_001 }),
    /maxRelationships must be an integer from 1 through 10000/,
  );
});
