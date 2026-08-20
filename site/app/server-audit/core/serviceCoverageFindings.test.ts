import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditServiceCoverageFindings } from "./serviceCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(services: NonNullable<ServerAuditSnapshot["services"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T15:30:00.000Z",
    host: { hostname: "audit-host" },
    services,
    metadata: { redactionsApplied: true },
  };
}

test("service coverage reports explicit empty inventory but leaves absent section to generic coverage", () => {
  const empty = createServerAuditServiceCoverageFindings(snapshot([]));
  assert.equal(empty.length, 1);
  assert.equal(empty[0].title, "No service records supplied");
  assert.deepEqual(empty[0].evidence, [{ source: "services", summary: "0 service records" }]);

  const absent: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T15:30:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  };
  assert.deepEqual(createServerAuditServiceCoverageFindings(absent), []);
});

test("service coverage does not invent per-record enablement gaps the official collector cannot satisfy", () => {
  const findings = createServerAuditServiceCoverageFindings(snapshot([
    { name: "private-customer-worker.service", state: "active running" },
    { name: "legacy-optional-enabled.service", state: "inactive dead", enabled: "disabled" },
  ]));

  assert.deepEqual(findings, []);
});

test("service coverage output is deterministic and does not expose service names", () => {
  const first = createServerAuditServiceCoverageFindings(snapshot([]));
  const second = createServerAuditServiceCoverageFindings(snapshot([]));

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).includes("private-customer-worker"), false);
});
