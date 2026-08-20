import assert from "node:assert/strict";
import test from "node:test";

import { analyzeServerAuditServiceListenerRelationships } from "./serviceListenerRelationships";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:00:00.000Z",
    host: { hostname: "audit-host" },
    services: [
      { name: "private-api.service", state: "active" },
      { name: "private-worker.service", state: "active" },
      { name: "missing.service", state: "inactive" },
      { name: "invalid service name", state: "unknown" },
    ],
    processes: [
      { pid: 10, ppid: 1, uid: 1000, state: "S", name: "private-api" },
      { pid: 20, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
      { pid: 21, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
    ],
    listeningSockets: [
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3000, process: "private-api" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3001, process: "private-worker" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3002, process: "missing" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("service-listener analysis emits only exact, structural three-way attribution", () => {
  const result = analyzeServerAuditServiceListenerRelationships(snapshot());

  assert.equal(result.schema, "solvelang.server-audit.service-listener-relationships.v0");
  assert.equal(result.mode, "analyze-only");
  assert.deepEqual(
    result.relationships.map((entry) => entry.kind).sort(),
    ["service-listener", "ambiguous-service-listener"].sort(),
  );
  assert.equal(result.summary.servicesChecked, 4);
  assert.equal(result.summary.processesChecked, 3);
  assert.equal(result.summary.listenersChecked, 3);
  assert.equal(result.summary.matchedServices, 2);
  assert.equal(result.summary.listenerRelationshipsFound, 1);
  assert.equal(result.summary.ambiguousListenerAttributions, 1);
  assert.equal(result.summary.unresolvedListenerAttributions, 1);
  assert.equal(result.summary.unmatchedServices, 1);
  assert.equal(result.summary.skippedServiceNames, 1);
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);

  const serialized = JSON.stringify(result);
  for (const sensitive of ["private-api", "private-worker", "missing", "invalid service name"]) {
    assert.equal(serialized.includes(sensitive), false);
  }
  assert.ok(serialized.includes("services[0]"));
  assert.ok(serialized.includes("processes[0]"));
  assert.ok(serialized.includes("listeningSockets[0]"));
});

test("service-listener analysis does not infer aliases, paths, or case-folded names", () => {
  const input = snapshot();
  input.services = [
    { name: "CaseSensitive.service", state: "active" },
    { name: "pathlike.service", state: "active" },
  ];
  input.processes = [
    { pid: 40, ppid: 1, uid: 0, state: "S", name: "casesensitive" },
    { pid: 41, ppid: 1, uid: 0, state: "S", name: "/usr/bin/pathlike" },
  ];
  input.listeningSockets = [
    { protocol: "tcp", localAddress: "127.0.0.1", port: 4000, process: "casesensitive" },
    { protocol: "tcp", localAddress: "127.0.0.1", port: 4001, process: "/usr/bin/pathlike" },
  ];

  const result = analyzeServerAuditServiceListenerRelationships(input);
  assert.deepEqual(result.relationships, []);
  assert.equal(result.summary.unmatchedServices, 2);
});

test("service-listener analysis uses the same exact-label contract for Linux, macOS, and Windows-shaped fixtures", () => {
  const input = snapshot();
  input.services = [
    { name: "linux-api.service", state: "active" },
    { name: "com.example.mac-daemon", state: "active" },
    { name: "WindowsService", state: "running" },
  ];
  input.processes = [
    { pid: 50, ppid: 1, uid: 0, state: "S", name: "linux-api" },
    { pid: 51, ppid: 1, uid: 501, state: "S", name: "com.example.mac-daemon" },
    { pid: 52, ppid: 1, uid: 0, state: "R", name: "WindowsService" },
  ];
  input.listeningSockets = [
    { protocol: "tcp", localAddress: "127.0.0.1", port: 5000, process: "linux-api" },
    { protocol: "tcp", localAddress: "127.0.0.1", port: 5001, process: "com.example.mac-daemon" },
    { protocol: "tcp", localAddress: "127.0.0.1", port: 5002, process: "WindowsService" },
  ];

  const result = analyzeServerAuditServiceListenerRelationships(input);
  assert.equal(result.relationships.length, 3);
  assert.equal(result.summary.listenerRelationshipsFound, 3);
  assert.equal(result.summary.ambiguousListenerAttributions, 0);
  assert.equal(result.summary.unresolvedListenerAttributions, 0);
});

test("service-listener analysis is deterministic, bounded, and rejects invalid bounds", () => {
  const input = snapshot();
  const first = analyzeServerAuditServiceListenerRelationships(input, { maxRelationships: 1 });
  const second = analyzeServerAuditServiceListenerRelationships(structuredClone(input), { maxRelationships: 1 });

  assert.deepEqual(first, second);
  assert.equal(first.relationships.length, 1);
  assert.equal(first.execution.relationshipsTruncated, true);
  assert.ok(first.relationships.every((entry) => /^server-service-listener:[a-f0-9]{8}$/.test(entry.id)));
  assert.throws(
    () => analyzeServerAuditServiceListenerRelationships(input, { maxRelationships: 0 }),
    /service-listener maxRelationships/,
  );
});

test("service-listener analysis bounds repeated-label Cartesian candidates during construction", () => {
  const input = snapshot();
  input.services = Array.from({ length: 5_000 }, () => ({ name: "shared.service", state: "active" }));
  input.processes = [{ pid: 50, ppid: 1, uid: 0, state: "S", name: "shared" }];
  input.listeningSockets = Array.from({ length: 5_000 }, (_, index) => ({
    protocol: "tcp",
    localAddress: "127.0.0.1",
    port: 10_000 + index,
    process: "shared",
  }));

  const result = analyzeServerAuditServiceListenerRelationships(input, { maxRelationships: 7 });

  assert.equal(result.relationships.length, 7);
  assert.equal(result.execution.relationshipsTruncated, true);
  assert.equal(result.summary.listenerRelationshipsFound, 25_000_000);
  assert.equal(result.summary.ambiguousListenerAttributions, 0);
  assert.equal(result.summary.matchedServices, 5_000);
});
