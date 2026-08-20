import assert from "node:assert/strict";
import test from "node:test";

import { analyzeServerAuditScheduledJobRelationships } from "./scheduledJobRelationships";
import type { ServerAuditSnapshot } from "./types";

test("indexed scheduled-job targets preserve service candidate precedence without duplicate relationships", () => {
  const snapshot: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T21:00:00.000Z",
    host: { hostname: "audit-host" },
    services: [{ name: "nginx.service", state: "active" }],
    processes: [{ pid: 10, ppid: 1, uid: 1000, state: "S", name: "nginx" }],
    scheduledJobs: [{ source: "timer", commandSummary: "nginx.service nginx" }],
  };

  const result = analyzeServerAuditScheduledJobRelationships(snapshot);
  const serviceRelationships = result.relationships.filter(
    (relationship) => relationship.kind === "scheduled-job-service",
  );

  assert.equal(result.summary.relationshipsObserved, 2);
  assert.equal(serviceRelationships.length, 1);
  assert.match(serviceRelationships[0]?.evidence.summary ?? "", /'nginx\.service'/);
  assert.deepEqual(
    result.relationships.map((relationship) => relationship.kind),
    ["scheduled-job-process", "scheduled-job-service"],
  );
});

test("indexed scheduled-job targets preserve sparse target indexes", () => {
  const services = Array.from({ length: 250 }, (_, index) => ({
    name: index === 249 ? "late-match.service" : `service-${index}.service`,
    state: "active",
  }));
  const snapshot: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T21:00:00.000Z",
    host: { hostname: "audit-host" },
    services,
    scheduledJobs: [{ source: "timer", commandSummary: "late-match.service" }],
  };

  const result = analyzeServerAuditScheduledJobRelationships(snapshot, { maxTargets: 250 });
  assert.equal(result.summary.relationshipsObserved, 1);
  assert.equal(result.relationships[0]?.targetIndex, 249);
  assert.equal(result.execution.targetsTruncated, false);
});
