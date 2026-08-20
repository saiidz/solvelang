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

test("service coverage reports missing enablement evidence without service-name leakage", () => {
  const findings = createServerAuditServiceCoverageFindings(snapshot([
    { name: "private-customer-worker.service", state: "active" },
    { name: "complete.service", state: "active", enabled: "enabled" },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Service record lacks enablement evidence");
  assert.deepEqual(findings[0].evidence, [{ source: "services[0].enabled", summary: "enablement evidence is absent" }]);
  assert.equal(JSON.stringify(findings).includes("private-customer-worker"), false);
});

test("service coverage reports explicit empty inventory but leaves absent section to generic coverage", () => {
  const empty = createServerAuditServiceCoverageFindings(snapshot([]));
  assert.equal(empty.length, 1);
  assert.equal(empty[0].title, "No service records supplied");

  const absent: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T15:30:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  };
  assert.deepEqual(createServerAuditServiceCoverageFindings(absent), []);
});

test("service coverage does not report entries with explicit enablement evidence", () => {
  const findings = createServerAuditServiceCoverageFindings(snapshot([
    { name: "enabled.service", state: "active", enabled: "enabled" },
    { name: "disabled.service", state: "inactive", enabled: "disabled" },
  ]));

  assert.deepEqual(findings, []);
});

test("service coverage output is deterministic and bounded", () => {
  const services = Array.from({ length: 105 }, (_, index) => ({
    name: `private-service-${index}.service`,
    state: "active",
  }));
  const first = createServerAuditServiceCoverageFindings(snapshot(services), { maxFindings: 10 });
  const second = createServerAuditServiceCoverageFindings(snapshot(services), { maxFindings: 10 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 10);
  assert.equal(first.filter((finding) => finding.title === "Service evidence coverage findings were truncated").length, 1);
  assert.equal(JSON.stringify(first).includes("private-service-104"), false);
  assert.throws(() => createServerAuditServiceCoverageFindings(snapshot(services), { maxFindings: 0 }), /service-coverage maxFindings/);
});
