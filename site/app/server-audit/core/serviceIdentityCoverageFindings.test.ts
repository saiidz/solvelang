import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditServiceIdentityCoverageFindings } from "./serviceIdentityCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(services: NonNullable<ServerAuditSnapshot["services"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T18:00:00.000Z",
    host: { hostname: "audit-host" },
    services,
    metadata: { redactionsApplied: true },
  };
}

test("service identity coverage reports blank normalized identities using structural evidence only", () => {
  const findings = createServerAuditServiceIdentityCoverageFindings(snapshot([
    { name: "   ", state: "active running", enabled: "enabled" },
    { name: "\t", state: "inactive dead", enabled: "disabled" },
    { name: "api.service", state: "active running", enabled: "enabled" },
  ]));

  assert.equal(findings.length, 2);
  assert.equal(findings[0]?.id, "srv_4c176e4e");
  assert.equal(findings.every((finding) => finding.severity === "info"), true);
  assert.equal(findings.every((finding) => finding.category === "coverage"), true);
  assert.equal(findings.every((finding) => finding.title === "Service record lacks a usable identity"), true);
  assert.deepEqual(findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source)).sort(), [
    "services[0].name",
    "services[1].name",
  ]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("api.service"), false);
  assert.equal(serialized.includes("active running"), false);
  assert.equal(serialized.includes("inactive dead"), false);
});

test("service identity coverage treats normalized non-empty identities as usable", () => {
  assert.deepEqual(createServerAuditServiceIdentityCoverageFindings(snapshot([
    { name: " api.service ", state: "active running" },
    { name: "é.service", state: "inactive dead" },
    { name: "e\u0301.service", state: "active exited" },
  ])), []);
});

test("service identity coverage output is deterministic and bounded", () => {
  const services = Array.from({ length: 105 }, () => ({ name: "   ", state: "unknown" }));
  const first = createServerAuditServiceIdentityCoverageFindings(snapshot(services));
  const second = createServerAuditServiceIdentityCoverageFindings(snapshot(services));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  const identityFindings = first.filter((finding) => finding.title === "Service record lacks a usable identity");
  assert.equal(identityFindings.length, 99);
  assert.equal(first.filter((finding) => finding.title === "Service identity coverage findings were truncated").length, 1);
  const structuralSources = identityFindings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source));
  assert.equal(new Set(structuralSources).size, 99);
  assert.equal(structuralSources.every((source) => /^services\[\d+\]\.name$/.test(source)), true);
});

test("service identity coverage materializes only bounded findings for high-cardinality identity gaps", () => {
  const services = Array.from({ length: 5_000 }, (_, index) => ({
    name: "   ",
    state: `private-state-${index}`,
    enabled: `private-enabled-${index}`,
  }));

  const findings = createServerAuditServiceIdentityCoverageFindings(snapshot(services));

  assert.equal(findings.length, 100);
  assert.equal(findings.filter((finding) => finding.title === "Service record lacks a usable identity").length, 99);
  assert.equal(findings.filter((finding) => finding.title === "Service identity coverage findings were truncated").length, 1);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-state-"), false);
  assert.equal(serialized.includes("private-enabled-"), false);
});

test("service identity coverage emits no finding when service evidence is absent", () => {
  assert.deepEqual(createServerAuditServiceIdentityCoverageFindings({
    schemaVersion: "1",
    collectedAt: "2026-08-20T18:00:00.000Z",
    host: { hostname: "audit-host" },
  }), []);
});
