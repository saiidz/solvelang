import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditServiceEnablementCoverageFindings } from "./serviceEnablementCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(services: NonNullable<ServerAuditSnapshot["services"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T07:10:00.000Z",
    host: { hostname: "audit-host" },
    services,
    metadata: { redactionsApplied: true },
  };
}

test("service enablement coverage reports absent or blank enablement using structural evidence only", () => {
  const findings = createServerAuditServiceEnablementCoverageFindings(snapshot([
    { name: "api.service", state: "active running" },
    { name: "worker.service", state: "active running", enabled: "   " },
    { name: "timer.service", state: "inactive dead", enabled: "disabled" },
  ]));

  assert.equal(findings.length, 2);
  assert.equal(findings.every((finding) => finding.severity === "info"), true);
  assert.equal(findings.every((finding) => finding.category === "coverage"), true);
  assert.equal(findings.every((finding) => finding.title === "Service record lacks usable enablement evidence"), true);
  assert.deepEqual(findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source)).sort(), [
    "services[0].enabled",
    "services[1].enabled",
  ]);

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("api.service"), false);
  assert.equal(serialized.includes("worker.service"), false);
  assert.equal(serialized.includes("timer.service"), false);
  assert.equal(serialized.includes("active running"), false);
  assert.equal(serialized.includes("inactive dead"), false);
  assert.equal(serialized.includes("disabled"), false);
});

test("service enablement coverage treats normalized non-empty values as usable without interpreting them", () => {
  assert.deepEqual(createServerAuditServiceEnablementCoverageFindings(snapshot([
    { name: "api.service", state: "active running", enabled: " enabled " },
    { name: "worker.service", state: "active running", enabled: "disabled" },
    { name: "custom.service", state: "mystery-state", enabled: "vendor-state" },
  ])), []);
});

test("service enablement coverage output is deterministic and bounded", () => {
  const services = Array.from({ length: 105 }, (_, index) => ({
    name: `service-${index}.service`,
    state: "active running",
  }));
  const first = createServerAuditServiceEnablementCoverageFindings(snapshot(services));
  const second = createServerAuditServiceEnablementCoverageFindings(snapshot(services));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  const enablementFindings = first.filter((finding) => finding.title === "Service record lacks usable enablement evidence");
  assert.equal(enablementFindings.length, 99);
  assert.equal(first.filter((finding) => finding.title === "Service enablement coverage findings were truncated").length, 1);
  const structuralSources = enablementFindings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source));
  assert.equal(new Set(structuralSources).size, 99);
  assert.equal(structuralSources.every((source) => /^services\[\d+\]\.enabled$/.test(source)), true);
  assert.equal(JSON.stringify(first).includes("service-104.service"), false);
});

test("service enablement coverage emits no finding for absent or explicitly empty service evidence", () => {
  assert.deepEqual(createServerAuditServiceEnablementCoverageFindings({
    schemaVersion: "1",
    collectedAt: "2026-08-21T07:10:00.000Z",
    host: { hostname: "audit-host" },
  }), []);
  assert.deepEqual(createServerAuditServiceEnablementCoverageFindings(snapshot([])), []);
});
