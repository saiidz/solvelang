import assert from "node:assert/strict";
import test from "node:test";
import { analyzeServerSnapshot } from "./analyze";
import type { ServerAuditSnapshot } from "./types";

function snapshot(security: NonNullable<ServerAuditSnapshot["security"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:50:00.000Z",
    host: { hostname: "audit-host" },
    security,
    metadata: { redactionsApplied: true },
  };
}

const CONFIGURATION_RISK_TITLES = [
  "Root SSH login is not disabled",
  "SSH password authentication remains enabled",
  "Host firewall not reported active",
  "Automatic security updates not confirmed",
];

test("unknown security probes remain coverage uncertainty instead of configuration findings", () => {
  const findings = analyzeServerSnapshot(snapshot({
    firewall: "unknown",
    automaticUpdates: "unknown",
    rootSshLogin: "unknown",
    passwordSshLogin: "unknown",
    selinux: "unknown",
    apparmor: "unknown",
  }));

  for (const title of CONFIGURATION_RISK_TITLES) {
    assert.equal(findings.some((finding) => finding.title === title), false);
  }

  const coverage = findings.find((finding) => finding.title === "Security posture probes are inconclusive");
  assert.ok(coverage);
  assert.equal(coverage.severity, "info");
  assert.equal(coverage.category, "coverage");
  assert.deepEqual(coverage.evidence, [
    { source: "security.firewall", summary: "value unavailable or unknown" },
    { source: "security.automaticUpdates", summary: "value unavailable or unknown" },
    { source: "security.rootSshLogin", summary: "value unavailable or unknown" },
    { source: "security.passwordSshLogin", summary: "value unavailable or unknown" },
    { source: "security.selinux", summary: "value unavailable or unknown" },
    { source: "security.apparmor", summary: "value unavailable or unknown" },
  ]);
  assert.equal(JSON.stringify(coverage).includes("PermitRootLogin=unknown"), false);
  assert.equal(JSON.stringify(coverage).includes("PasswordAuthentication=unknown"), false);
});

test("missing probe fields inside a supplied security section are reported as bounded coverage", () => {
  const findings = analyzeServerSnapshot(snapshot({ firewall: "active" }));
  const coverage = findings.find((finding) => finding.title === "Security posture probes are inconclusive");

  assert.ok(coverage);
  assert.deepEqual(coverage.evidence.map((evidence) => evidence.source), [
    "security.automaticUpdates",
    "security.rootSshLogin",
    "security.passwordSshLogin",
    "security.selinux",
    "security.apparmor",
  ]);
  assert.equal(findings.some((finding) => finding.title === "Host firewall not reported active"), false);
});

test("explicit observed insecure values retain configuration findings", () => {
  const findings = analyzeServerSnapshot(snapshot({
    firewall: "inactive",
    automaticUpdates: "disabled",
    rootSshLogin: "yes",
    passwordSshLogin: "yes",
    selinux: "enforcing",
    apparmor: "enabled",
  }));

  for (const title of CONFIGURATION_RISK_TITLES) {
    assert.equal(findings.some((finding) => finding.title === title), true);
  }
  assert.equal(findings.some((finding) => finding.title === "Security posture probes are inconclusive"), false);
});

test("explicit observed safe values do not create risk or coverage findings", () => {
  const findings = analyzeServerSnapshot(snapshot({
    firewall: "active",
    automaticUpdates: "enabled",
    rootSshLogin: "no",
    passwordSshLogin: "no",
    selinux: "enforcing",
    apparmor: "enabled",
  }));

  for (const title of CONFIGURATION_RISK_TITLES) {
    assert.equal(findings.some((finding) => finding.title === title), false);
  }
  assert.equal(findings.some((finding) => finding.title === "Security posture probes are inconclusive"), false);
});

test("SSH and firewall state parsing does not accept merely similar inactive values as safe", () => {
  const findings = analyzeServerSnapshot(snapshot({
    firewall: "not running",
    automaticUpdates: "enabled",
    rootSshLogin: "disabled",
    passwordSshLogin: "off",
    selinux: "enforcing",
    apparmor: "enabled",
  }));

  assert.equal(findings.some((finding) => finding.title === "Host firewall not reported active"), true);
  assert.equal(findings.some((finding) => finding.title === "Root SSH login is not disabled"), true);
  assert.equal(findings.some((finding) => finding.title === "SSH password authentication remains enabled"), true);
  assert.equal(findings.some((finding) => finding.title === "Automatic security updates not confirmed"), false);
  assert.equal(findings.some((finding) => finding.title === "Security posture probes are inconclusive"), false);
});
