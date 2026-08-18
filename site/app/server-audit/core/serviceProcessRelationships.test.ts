import assert from "node:assert/strict";
import test from "node:test";
import { analyzeServerAuditServiceProcessRelationships } from "./serviceProcessRelationships";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T20:00:00.000Z",
    host: { hostname: "audit-host" },
    services: [
      { name: "private-api.service", state: "active", enabled: "enabled" },
      { name: "private-worker.service", state: "active", enabled: "enabled" },
      { name: "missing.service", state: "inactive", enabled: "disabled" },
      { name: "bad service name", state: "unknown" },
    ],
    processes: [
      { pid: 10, ppid: 1, uid: 1000, state: "S", name: "private-api" },
      { pid: 20, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
      { pid: 21, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("service-process analysis maps exact structural evidence without emitting raw names", () => {
  const analysis = analyzeServerAuditServiceProcessRelationships(snapshot());

  assert.deepEqual(
    analysis.relationships.map((entry) => entry.kind).sort(),
    ["service-process", "service-process-group"].sort(),
  );
  assert.equal(analysis.summary.servicesChecked, 4);
  assert.equal(analysis.summary.processesChecked, 3);
  assert.equal(analysis.summary.matchedServices, 2);
  assert.equal(analysis.summary.groupedProcessMatches, 1);
  assert.equal(analysis.summary.unmatchedServices, 1);
  assert.equal(analysis.summary.skippedServiceNames, 1);
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);

  const serialized = JSON.stringify(analysis);
  for (const sensitive of ["private-api", "private-worker", "missing", "bad service name"]) {
    assert.equal(serialized.includes(sensitive), false);
  }
  assert.ok(serialized.includes("services[0]"));
  assert.ok(serialized.includes("processes[0]"));
});

test("service names without a .service suffix can match exact process names", () => {
  const input = snapshot();
  input.services = [{ name: "plain-daemon", state: "active" }];
  input.processes = [{ pid: 30, ppid: 1, uid: 1000, state: "S", name: "plain-daemon" }];

  const analysis = analyzeServerAuditServiceProcessRelationships(input);
  assert.equal(analysis.relationships.length, 1);
  assert.equal(analysis.relationships[0].kind, "service-process");
  assert.equal(analysis.summary.matchedServices, 1);
});

test("matching is conservative and does not case-fold or infer path aliases", () => {
  const input = snapshot();
  input.services = [
    { name: "CaseSensitive.service", state: "active" },
    { name: "pathlike.service", state: "active" },
  ];
  input.processes = [
    { pid: 40, ppid: 1, uid: 1000, state: "S", name: "casesensitive" },
    { pid: 41, ppid: 1, uid: 1000, state: "S", name: "/usr/bin/pathlike" },
  ];

  const analysis = analyzeServerAuditServiceProcessRelationships(input);
  assert.deepEqual(analysis.relationships, []);
  assert.equal(analysis.summary.unmatchedServices, 2);
});

test("grouped matches cap structural sources while preserving truncation truth", () => {
  const input = snapshot();
  input.services = [{ name: "many-workers.service", state: "active" }];
  input.processes = Array.from({ length: 100 }, (_, index) => ({
    pid: 1000 + index,
    ppid: 1,
    uid: 1000,
    state: "S",
    name: "many-workers",
  }));

  const analysis = analyzeServerAuditServiceProcessRelationships(input);
  assert.equal(analysis.relationships.length, 1);
  assert.equal(analysis.relationships[0].kind, "service-process-group");
  assert.equal(analysis.relationships[0].sources.length, analysis.execution.maxSourcesPerRelationship);
  assert.equal(analysis.relationships[0].sourcesTruncated, true);
  assert.equal(analysis.summary.relationshipsWithTruncatedSources, 1);
  assert.equal(JSON.stringify(analysis).includes("many-workers"), false);
});

test("service-process output is deterministic and bounded", () => {
  const input = snapshot();
  const first = analyzeServerAuditServiceProcessRelationships(input, { maxRelationships: 1 });
  const second = analyzeServerAuditServiceProcessRelationships(input, { maxRelationships: 1 });

  assert.deepEqual(first, second);
  assert.equal(first.relationships.length, 1);
  assert.equal(first.execution.relationshipsTruncated, true);
  assert.ok(first.relationships.every((entry) => /^server-service-process:[a-f0-9]{8}$/.test(entry.id)));
  assert.throws(
    () => analyzeServerAuditServiceProcessRelationships(input, { maxRelationships: 0 }),
    /service-process maxRelationships/,
  );
});
