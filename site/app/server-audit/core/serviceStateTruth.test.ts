import assert from "node:assert/strict";
import test from "node:test";
import { analyzeServerSnapshot } from "./analyze";
import type { ServerAuditSnapshot } from "./types";

function snapshot(state: string): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T17:25:00.000Z",
    host: { hostname: "audit-host" },
    services: [{ name: "example.service", state }],
    metadata: { redactionsApplied: true },
  };
}

function serviceHealthFindings(state: string) {
  return analyzeServerSnapshot(snapshot(state)).filter((finding) => finding.title === "Service is not healthy");
}

test("ordinary inactive and completed systemd units are not reported as unhealthy", () => {
  for (const state of ["inactive dead", "active exited", "inactive exited", "active running"]) {
    assert.deepEqual(serviceHealthFindings(state), [], state);
  }
});

test("explicit failed or error service states remain health findings", () => {
  for (const state of ["failed failed", "active failed", "error error"]) {
    const findings = serviceHealthFindings(state);
    assert.equal(findings.length, 1, state);
    assert.equal(findings[0]!.severity, "medium");
    assert.equal(findings[0]!.category, "service");
  }
});

test("service-state matching is token based rather than substring based", () => {
  assert.deepEqual(serviceHealthFindings("inactive dead"), []);
  assert.deepEqual(serviceHealthFindings("unfailed-looking healthy"), []);
  assert.equal(serviceHealthFindings("inactive error").length, 1);
});
