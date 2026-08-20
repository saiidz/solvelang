import assert from "node:assert/strict";
import test from "node:test";

import { createServerAuditServiceListenerRelationshipFindings } from "./serviceListenerRelationshipFindings";
import type { ServerAuditSnapshot } from "./types";

function relationshipSnapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T18:00:00.000Z",
    host: { hostname: "audit-host" },
    services: [
      { name: "private-api.service", state: "active" },
      { name: "private-worker.service", state: "active" },
      { name: "missing.service", state: "active" },
      { name: "invalid service label", state: "unknown" },
    ],
    processes: [
      { pid: 10, ppid: 1, uid: 1000, state: "S", name: "private-api" },
      { pid: 20, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
      { pid: 21, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
      { pid: 30, ppid: 1, uid: 1000, state: "S", name: "bad\u0001process" },
    ],
    listeningSockets: [
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3000, process: "private-api" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3001, process: "private-worker" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3002, process: "missing" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3003, process: "bad\u0001listener" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("service-listener findings surface ambiguous and incomplete attribution without raw labels", () => {
  const findings = createServerAuditServiceListenerRelationshipFindings(relationshipSnapshot());

  assert.deepEqual(
    findings.map((finding) => finding.title).sort(),
    [
      "Listener attribution is ambiguous across collected processes",
      "Service-listener mapping skipped unsupported label evidence",
      "Some service-listener attribution lacks collected process evidence",
    ].sort(),
  );
  assert.ok(findings.every((finding) => finding.severity === "info"));
  assert.ok(findings.every((finding) => finding.category === "coverage" || finding.category === "evidence-integrity"));

  const ambiguous = findings.find((finding) => finding.title === "Listener attribution is ambiguous across collected processes");
  assert.ok(ambiguous);
  assert.deepEqual(
    ambiguous.evidence.map((item) => item.source).sort(),
    ["listeningSockets[1]", "processes[1]", "processes[2]", "services[1]"].sort(),
  );

  const serialized = JSON.stringify(findings);
  for (const sensitive of [
    "private-api",
    "private-worker",
    "missing.service",
    "invalid service label",
    "bad\\u0001process",
    "bad\\u0001listener",
    "127.0.0.1",
  ]) {
    assert.equal(serialized.includes(sensitive), false);
  }
  assert.ok(serialized.includes("serviceListenerRelationships.summary.unresolvedListenerAttributions"));
  assert.ok(serialized.includes("serviceListenerRelationships.summary.skippedServiceNames"));
});

test("unique exact-label service-listener relationships do not become findings", () => {
  const input: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T18:00:00.000Z",
    host: { hostname: "audit-host" },
    services: [{ name: "api.service", state: "active" }],
    processes: [{ pid: 10, ppid: 1, uid: 1000, state: "S", name: "api" }],
    listeningSockets: [{ protocol: "tcp", localAddress: "127.0.0.1", port: 3000, process: "api" }],
  };

  assert.deepEqual(createServerAuditServiceListenerRelationshipFindings(input), []);
});

test("service-listener findings preserve deterministic relationship truncation truth", () => {
  const input: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T18:00:00.000Z",
    host: { hostname: "audit-host" },
    services: [
      { name: "api.service", state: "active" },
      { name: "worker.service", state: "active" },
    ],
    processes: [
      { pid: 10, ppid: 1, uid: 1000, state: "S", name: "api" },
      { pid: 20, ppid: 1, uid: 1000, state: "S", name: "worker" },
    ],
    listeningSockets: [
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3000, process: "api" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3001, process: "worker" },
    ],
  };

  const first = createServerAuditServiceListenerRelationshipFindings(input, { maxRelationships: 1 });
  const second = createServerAuditServiceListenerRelationshipFindings(structuredClone(input), { maxRelationships: 1 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0].title, "Service-listener relationships were truncated");
  assert.match(first[0].id, /^srv_[a-f0-9]{8}$/);
  assert.equal(JSON.stringify(first).includes("api.service"), false);
  assert.equal(JSON.stringify(first).includes("worker.service"), false);
});
