import assert from "node:assert/strict";
import test from "node:test";
import { analyzeServerSnapshot } from "./analyze";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T08:05:00.000Z",
    host: { hostname: "audit-host" },
    security: {
      firewall: "inactive-private-firewall-canary",
      automaticUpdates: "disabled-private-updates-canary",
      rootSshLogin: "yes-private-root-canary",
      passwordSshLogin: "yes-private-password-canary",
      selinux: "enforcing",
      apparmor: "enabled",
    },
    metadata: { redactionsApplied: true },
  };
}

const EXPECTED_EVIDENCE = new Map([
  ["Root SSH login is not disabled", {
    source: "security.rootSshLogin",
    summary: "observed value does not indicate disabled root login",
  }],
  ["SSH password authentication remains enabled", {
    source: "security.passwordSshLogin",
    summary: "observed value does not indicate disabled password login",
  }],
  ["Host firewall not reported active", {
    source: "security.firewall",
    summary: "observed value does not match reviewed active-state tokens",
  }],
  ["Automatic security updates not confirmed", {
    source: "security.automaticUpdates",
    summary: "observed value does not match reviewed enabled-state tokens",
  }],
]);

const PRIVATE_VALUES = [
  "inactive-private-firewall-canary",
  "disabled-private-updates-canary",
  "yes-private-root-canary",
  "yes-private-password-canary",
];

test("security posture findings keep supplied values out of finding payloads", () => {
  const findings = analyzeServerSnapshot(snapshot());

  for (const [title, evidence] of EXPECTED_EVIDENCE) {
    const finding = findings.find((candidate) => candidate.title === title);
    assert.ok(finding, title);
    assert.deepEqual(finding.evidence, [evidence], title);
  }

  const serialized = JSON.stringify(findings);
  for (const privateValue of PRIVATE_VALUES) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("canonical reports retain structural security evidence without raw supplied values", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-21T08:06:00.000Z");
  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);

  for (const privateValue of PRIVATE_VALUES) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  for (const evidence of EXPECTED_EVIDENCE.values()) {
    assert.ok(json.includes(evidence.source));
    assert.ok(html.includes(evidence.source));
  }
});
