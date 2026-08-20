import assert from "node:assert/strict";
import test from "node:test";

import { createServerAuditScheduledJobRelationshipFindings } from "./scheduledJobRelationshipFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T20:40:00.000Z",
    host: { hostname: "audit-host" },
    services: [
      { name: "private-api.service", state: "active" },
      { name: "private-worker.service", state: "active" },
    ],
    processes: [
      { pid: 10, ppid: 1, uid: 1000, state: "S", name: "private-api" },
      { pid: 20, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
    ],
    scheduledJobs: [
      {
        source: "cron:/private/api",
        schedule: "*/5 * * * *",
        commandSummary: "private-api.service private-api",
      },
      {
        source: "cron:/private/unmatched",
        schedule: "0 2 * * *",
        commandSummary: "unrelated-task --run",
      },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("scheduled-job relationship findings expose multi-target and unresolved truth with structural evidence only", () => {
  const findings = createServerAuditScheduledJobRelationshipFindings(snapshot());

  const multiple = findings.find((finding) => finding.title === "Scheduled job maps to multiple collected targets");
  const unresolved = findings.find(
    (finding) => finding.title === "Some scheduled jobs have no exact-name-token relationship",
  );

  assert.ok(multiple);
  assert.ok(unresolved);
  assert.deepEqual(
    multiple.evidence.map((item) => item.source).sort(),
    ["processes[0]", "scheduledJobs[0]", "services[0]"].sort(),
  );
  assert.equal(multiple.severity, "info");
  assert.equal(unresolved.severity, "info");

  const serialized = JSON.stringify(findings);
  for (const sensitive of [
    "private-api",
    "private-worker",
    "cron:/private/api",
    "cron:/private/unmatched",
    "*/5 * * * *",
    "0 2 * * *",
  ]) {
    assert.equal(serialized.includes(sensitive), false);
  }
});

test("a unique exact-name-token scheduled-job relationship remains finding-free", () => {
  const input: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T20:40:00.000Z",
    host: { hostname: "audit-host" },
    services: [{ name: "api.service", state: "active" }],
    scheduledJobs: [{ source: "timer", commandSummary: "api.service" }],
    metadata: { redactionsApplied: true },
  };

  assert.deepEqual(createServerAuditScheduledJobRelationshipFindings(input), []);
});

test("scheduled-job relationship findings preserve deterministic partial-scan truth", () => {
  const input = snapshot();
  input.scheduledJobs = [
    { source: "too-long", commandSummary: "x".repeat(20) },
    { source: "match", commandSummary: "private-api.service" },
  ];

  const findings = createServerAuditScheduledJobRelationshipFindings(input, {
    maxJobs: 1,
    maxTargets: 1,
    maxRelationships: 1,
    maxCommandSummaryCharacters: 10,
  });
  const partial = findings.find((finding) => finding.title === "Scheduled-job relationship analysis is partial");

  assert.ok(partial);
  assert.deepEqual(partial.evidence, [
    { source: "scheduledJobRelationships.execution.maxJobs", summary: "1" },
    { source: "scheduledJobRelationships.execution.maxTargets", summary: "1" },
    { source: "scheduledJobRelationships.execution.oversizedCommandSummariesSkipped", summary: "1" },
  ]);
  assert.equal(JSON.stringify(partial).includes("too-long"), false);
  assert.equal(JSON.stringify(partial).includes("private-api"), false);
});

test("scheduled-job relationship findings are deterministic", () => {
  const first = createServerAuditScheduledJobRelationshipFindings(snapshot());
  const second = createServerAuditScheduledJobRelationshipFindings(structuredClone(snapshot()));
  assert.deepEqual(first, second);
});
