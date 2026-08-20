import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditScheduledJobCoverageFindings } from "./scheduledJobCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(scheduledJobs: NonNullable<ServerAuditSnapshot["scheduledJobs"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:30:00.000Z",
    host: { hostname: "audit-host" },
    scheduledJobs,
    metadata: { redactionsApplied: true },
  };
}

test("scheduled-job coverage reports explicit empty inventory but leaves absent section to generic coverage", () => {
  const empty = createServerAuditScheduledJobCoverageFindings(snapshot([]));
  assert.equal(empty.length, 1);
  assert.equal(empty[0].title, "No scheduled-job records supplied");
  assert.deepEqual(empty[0].evidence, [{ source: "scheduledJobs", summary: "0 scheduled-job records" }]);

  const absent: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:30:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  };
  assert.deepEqual(createServerAuditScheduledJobCoverageFindings(absent), []);
});

test("scheduled-job coverage does not report a concrete scheduled-job inventory", () => {
  const findings = createServerAuditScheduledJobCoverageFindings(snapshot([
    {
      source: "/etc/cron.daily/private-job",
      commandSummary: "command content intentionally not collected",
    },
  ]));
  assert.deepEqual(findings, []);
});

test("scheduled-job coverage output is deterministic and emits structural evidence only", () => {
  const first = createServerAuditScheduledJobCoverageFindings(snapshot([]));
  const second = createServerAuditScheduledJobCoverageFindings(snapshot([]));

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).includes("private-job"), false);
  assert.equal(JSON.stringify(first).includes("/etc/cron"), false);
});
