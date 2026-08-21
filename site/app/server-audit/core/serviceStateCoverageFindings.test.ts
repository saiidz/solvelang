import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditServiceStateCoverageFindings } from "./serviceStateCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(services: NonNullable<ServerAuditSnapshot["services"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T06:20:00.000Z",
    host: { hostname: "audit-host" },
    services,
    metadata: { redactionsApplied: true },
  };
}

test("service state coverage reports blank normalized state using structural evidence only", () => {
  const findings = createServerAuditServiceStateCoverageFindings(snapshot([
    { name: "api.service", state: "   ", enabled: "enabled" },
    { name: "worker.service", state: "\t", enabled: "disabled" },
    { name: "timer.service", state: "inactive dead", enabled: "disabled" },
  ]));

  assert.equal(findings.length, 2);
  assert.equal(findings.every((finding) => finding.severity === "info"), true);
  assert.equal(findings.every((finding) => finding.category === "coverage"), true);
  assert.equal(findings.every((finding) => finding.title === "Service record lacks usable state evidence"), true);
  assert.deepEqual(findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source)).sort(), [
    "services[0].state",
    "services[1].state",
  ]);

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("api.service"), false);
  assert.equal(serialized.includes("worker.service"), false);
  assert.equal(serialized.includes("timer.service"), false);
  assert.equal(serialized.includes("inactive dead"), false);
  assert.equal(serialized.includes("enabled"), false);
  assert.equal(serialized.includes("disabled"), false);
});

test("service state coverage treats normalized non-empty states as usable without interpreting them", () => {
  assert.deepEqual(createServerAuditServiceStateCoverageFindings(snapshot([
    { name: "api.service", state: " active running " },
    { name: "oneshot.service", state: "active exited" },
    { name: "custom.service", state: "mystery-state" },
  ])), []);
});

test("service state coverage output is deterministic and bounded", () => {
  const services = Array.from({ length: 105 }, (_, index) => ({
    name: `service-${index}.service`,
    state: "   ",
  }));
  const first = createServerAuditServiceStateCoverageFindings(snapshot(services));
  const second = createServerAuditServiceStateCoverageFindings(snapshot(services));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  const stateFindings = first.filter((finding) => finding.title === "Service record lacks usable state evidence");
  assert.equal(stateFindings.length, 99);
  assert.equal(first.filter((finding) => finding.title === "Service state coverage findings were truncated").length, 1);
  const structuralSources = stateFindings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source));
  assert.equal(new Set(structuralSources).size, 99);
  assert.equal(structuralSources.every((source) => /^services\[\d+\]\.state$/.test(source)), true);
  assert.equal(JSON.stringify(first).includes("service-104.service"), false);
});

test("service state coverage emits no finding for absent or explicitly empty service evidence", () => {
  assert.deepEqual(createServerAuditServiceStateCoverageFindings({
    schemaVersion: "1",
    collectedAt: "2026-08-21T06:20:00.000Z",
    host: { hostname: "audit-host" },
  }), []);
  assert.deepEqual(createServerAuditServiceStateCoverageFindings(snapshot([])), []);
});
