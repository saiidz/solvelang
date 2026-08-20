import assert from "node:assert/strict";
import test from "node:test";

import { createServerAuditServiceProcessRelationshipFindings } from "./serviceProcessRelationshipFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T20:00:00.000Z",
    host: { hostname: "audit-host" },
    services: [
      { name: "private-api.service", state: "active" },
      { name: "private-worker.service", state: "active" },
      { name: "missing.service", state: "inactive" },
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

test("service-process findings preserve grouped, unmatched, and skipped relationship truth without raw labels", () => {
  const findings = createServerAuditServiceProcessRelationshipFindings(snapshot());

  const grouped = findings.find((finding) => finding.title === "Service maps to multiple collected process records");
  const unmatched = findings.find(
    (finding) => finding.title === "Some collected services have no exact-label process relationship",
  );
  const skipped = findings.find(
    (finding) => finding.title === "Service-process mapping skipped unsupported service labels",
  );

  assert.ok(grouped);
  assert.ok(unmatched);
  assert.ok(skipped);
  assert.deepEqual(
    grouped.evidence.map((item) => item.source).sort(),
    ["processes[1]", "processes[2]", "services[1]"].sort(),
  );
  assert.equal(grouped.severity, "info");
  assert.equal(unmatched.severity, "info");
  assert.equal(skipped.severity, "info");

  const serialized = JSON.stringify(findings);
  for (const sensitive of ["private-api", "private-worker", "missing.service", "bad service name"]) {
    assert.equal(serialized.includes(sensitive), false);
  }
});

test("a unique exact-label service-process relationship remains finding-free", () => {
  const input: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T20:00:00.000Z",
    host: { hostname: "audit-host" },
    services: [{ name: "api.service", state: "active" }],
    processes: [{ pid: 10, ppid: 1, uid: 1000, state: "S", name: "api" }],
    metadata: { redactionsApplied: true },
  };

  assert.deepEqual(createServerAuditServiceProcessRelationshipFindings(input), []);
});

test("grouped service-process findings preserve structural source truncation truth", () => {
  const input: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T20:00:00.000Z",
    host: { hostname: "audit-host" },
    services: [{ name: "many-workers.service", state: "active" }],
    processes: Array.from({ length: 100 }, (_, index) => ({
      pid: 1000 + index,
      ppid: 1,
      uid: 1000,
      state: "S",
      name: "many-workers",
    })),
    metadata: { redactionsApplied: true },
  };

  const findings = createServerAuditServiceProcessRelationshipFindings(input);
  const grouped = findings.find((finding) => finding.title === "Service maps to multiple collected process records");

  assert.ok(grouped);
  assert.equal(grouped.evidence.length, 33);
  assert.ok(grouped.evidence.some((item) => item.source.startsWith("server-service-process:")));
  assert.ok(grouped.summary.includes("fanout was truncated"));
  assert.equal(JSON.stringify(grouped).includes("many-workers"), false);
});

test("service-process findings expose relationship truncation as bounded coverage truth", () => {
  const input: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T20:00:00.000Z",
    host: { hostname: "audit-host" },
    services: [
      { name: "one.service", state: "active" },
      { name: "two.service", state: "active" },
    ],
    processes: [
      { pid: 10, ppid: 1, uid: 1000, state: "S", name: "one" },
      { pid: 20, ppid: 1, uid: 1000, state: "S", name: "two" },
    ],
    metadata: { redactionsApplied: true },
  };

  const findings = createServerAuditServiceProcessRelationshipFindings(input, { maxRelationships: 1 });
  const truncated = findings.find((finding) => finding.title === "Service-process relationships were truncated");

  assert.ok(truncated);
  assert.deepEqual(truncated.evidence, [{
    source: "serviceProcessRelationships.execution.maxRelationships",
    summary: "1",
  }]);
});
