import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditSecurityCoverageFindings } from "./securityCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(security?: ServerAuditSnapshot["security"]): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T15:30:00.000Z",
    host: { hostname: "audit-host" },
    ...(security === undefined ? {} : { security }),
    metadata: { redactionsApplied: true },
  };
}

test("security coverage reports missing core fields using structural evidence only", () => {
  const findings = createServerAuditSecurityCoverageFindings(snapshot({
    firewall: "active",
    rootSshLogin: "no",
  }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "info");
  assert.equal(findings[0].category, "coverage");
  assert.equal(findings[0].title, "Core security posture fields are incomplete");
  assert.deepEqual(findings[0].evidence, [
    { source: "security.automaticUpdates", summary: "field absent" },
    { source: "security.passwordSshLogin", summary: "field absent" },
  ]);
  assert.equal(JSON.stringify(findings).includes("active"), false);
});

test("security coverage is deterministic and reports at most the four core fields", () => {
  const first = createServerAuditSecurityCoverageFindings(snapshot({}));
  const second = createServerAuditSecurityCoverageFindings(snapshot({}));

  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].evidence.map((item) => item.source), [
    "security.firewall",
    "security.automaticUpdates",
    "security.rootSshLogin",
    "security.passwordSshLogin",
  ]);
});

test("security coverage leaves an absent section to the generic coverage stage", () => {
  assert.deepEqual(createServerAuditSecurityCoverageFindings(snapshot()), []);
});

test("security coverage emits no finding when all core fields are supplied", () => {
  assert.deepEqual(createServerAuditSecurityCoverageFindings(snapshot({
    firewall: "active",
    automaticUpdates: "enabled",
    rootSshLogin: "no",
    passwordSshLogin: "no",
  })), []);
});
