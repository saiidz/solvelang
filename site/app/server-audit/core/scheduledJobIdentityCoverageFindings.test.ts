import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditScheduledJobIdentityCoverageFindings } from "./scheduledJobIdentityCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(scheduledJobs: NonNullable<ServerAuditSnapshot["scheduledJobs"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T18:00:00.000Z",
    host: { hostname: "audit-host" },
    scheduledJobs,
    metadata: { redactionsApplied: true },
  };
}

test("scheduled-job identity coverage reports blank source and command identities structurally", () => {
  const findings = createServerAuditScheduledJobIdentityCoverageFindings(snapshot([
    { source: "   ", schedule: "0 * * * *", commandSummary: "private-command-a" },
    { source: "/private/cron/source", schedule: "*/5 * * * *", commandSummary: "\t" },
    { source: "cron.daily", schedule: "daily", commandSummary: "private-command-b" },
  ]));

  assert.equal(findings.length, 2);
  assert.equal(findings.every((finding) => finding.severity === "info"), true);
  assert.equal(findings.every((finding) => finding.category === "coverage"), true);
  assert.deepEqual(findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source)).sort(), [
    "scheduledJobs[0].source",
    "scheduledJobs[1].commandSummary",
  ]);

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-command-a"), false);
  assert.equal(serialized.includes("private-command-b"), false);
  assert.equal(serialized.includes("/private/cron/source"), false);
  assert.equal(serialized.includes("0 * * * *"), false);
  assert.equal(serialized.includes("*/5 * * * *"), false);
});

test("scheduled-job identity coverage treats normalized non-empty identities as usable", () => {
  assert.deepEqual(createServerAuditScheduledJobIdentityCoverageFindings(snapshot([
    { source: " cron.daily ", schedule: "daily", commandSummary: " rotate-logs " },
    { source: "é-source", commandSummary: "é-command" },
    { source: "e\u0301-source", commandSummary: "e\u0301-command" },
  ])), []);
});

test("scheduled-job identity coverage is deterministic and bounded across both identity fields", () => {
  const scheduledJobs = Array.from({ length: 60 }, () => ({ source: " ", commandSummary: "\t" }));
  const first = createServerAuditScheduledJobIdentityCoverageFindings(snapshot(scheduledJobs));
  const second = createServerAuditScheduledJobIdentityCoverageFindings(snapshot(scheduledJobs));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  assert.equal(first.filter((finding) => finding.title === "Scheduled-job identity coverage findings were truncated").length, 1);

  const identityFindings = first.filter((finding) => finding.title !== "Scheduled-job identity coverage findings were truncated");
  assert.equal(identityFindings.length, 99);
  assert.equal(identityFindings.every((finding) => finding.evidence.every((evidence) => /^scheduledJobs\[\d+\]\.(source|commandSummary)$/.test(evidence.source))), true);
  assert.equal(new Set(identityFindings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source))).size, 99);
});

test("scheduled-job identity coverage retains only bounded findings under high-cardinality gaps", () => {
  const scheduledJobs = Array.from({ length: 5_000 }, (_, index) => ({
    source: " ",
    schedule: `private-schedule-${index}`,
    commandSummary: "\t",
  }));
  const findings = createServerAuditScheduledJobIdentityCoverageFindings(snapshot(scheduledJobs));

  assert.equal(findings.length, 100);
  assert.equal(findings.filter((finding) => finding.title === "Scheduled-job identity coverage findings were truncated").length, 1);

  const identityFindings = findings.filter((finding) => finding.title !== "Scheduled-job identity coverage findings were truncated");
  assert.equal(identityFindings.length, 99);
  assert.equal(identityFindings.every((finding) => finding.evidence.every((evidence) => /^scheduledJobs\[\d+\]\.(source|commandSummary)$/.test(evidence.source))), true);
  assert.equal(new Set(identityFindings.map((finding) => finding.id)).size, 99);
  assert.equal(JSON.stringify(findings).includes("private-schedule-"), false);
});

test("scheduled-job identity coverage emits no finding when scheduled-job evidence is absent", () => {
  assert.deepEqual(createServerAuditScheduledJobIdentityCoverageFindings({
    schemaVersion: "1",
    collectedAt: "2026-08-20T18:00:00.000Z",
    host: { hostname: "audit-host" },
  }), []);
});
