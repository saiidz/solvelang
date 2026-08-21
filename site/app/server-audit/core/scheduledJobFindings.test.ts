import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditScheduledJobFindings } from "./scheduledJobFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(scheduledJobs: NonNullable<ServerAuditSnapshot["scheduledJobs"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T18:35:00.000Z",
    host: { hostname: "audit-host" },
    scheduledJobs,
  };
}

test("official collector placeholder produces no privacy finding", () => {
  const findings = createServerAuditScheduledJobFindings(snapshot([
    {
      source: "/etc/cron.daily/backup",
      commandSummary: "command content intentionally not collected",
    },
  ]));
  assert.deepEqual(findings, []);
});

test("non-placeholder command text is never echoed or interpreted", () => {
  const findings = createServerAuditScheduledJobFindings(snapshot([
    {
      source: "/etc/cron.d/private-customer-job",
      schedule: "*/5 * * * *",
      commandSummary: "curl https://example.invalid/?token=super-secret-value",
    },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "medium");
  assert.equal(findings[0].category, "privacy");
  assert.equal(findings[0].evidence[0].source, "scheduledJobs[0].commandSummary");
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("super-secret-value"), false);
  assert.equal(serialized.includes("private-customer-job"), false);
  assert.equal(serialized.includes("example.invalid"), false);
});

test("conflicting duplicate job sources use structural evidence only", () => {
  const findings = createServerAuditScheduledJobFindings(snapshot([
    {
      source: "/etc/cron.d/private-job",
      schedule: "0 * * * *",
      commandSummary: "command content intentionally not collected",
    },
    {
      source: "/etc/cron.d/private-job",
      schedule: "15 * * * *",
      commandSummary: "command content intentionally not collected",
    },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, "srv_f315db38");
  assert.equal(findings[0].category, "evidence-integrity");
  assert.deepEqual(findings[0].evidence.map((item) => item.source), ["scheduledJobs[0]", "scheduledJobs[1]"]);
  assert.equal(JSON.stringify(findings).includes("private-job"), false);
});

test("conflicting duplicate job evidence stays bounded and preserves a late witness", () => {
  const jobs = Array.from({ length: 5_000 }, (_, index) => ({
    source: "/etc/cron.d/private-high-cardinality-job",
    schedule: index === 4_999 ? "15 * * * *" : "0 * * * *",
    commandSummary: "command content intentionally not collected",
  }));

  const findings = createServerAuditScheduledJobFindings(snapshot(jobs));
  const conflict = findings.find((finding) => finding.title === "Scheduled-job inventory reports conflicting duplicate evidence");

  assert.equal(findings.length, 1);
  assert.equal(conflict?.id, "srv_fc5bc2a7");
  assert.equal(conflict?.evidence.length, 32);
  assert.equal(conflict?.evidence[0]?.source, "scheduledJobs[0]");
  assert.equal(conflict?.evidence[31]?.source, "scheduledJobs[4999]");
  assert.match(conflict?.summary ?? "", /retains 32 of 5000 structural witness references/);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-high-cardinality-job"), false);
  assert.equal(serialized.includes("15 * * * *"), false);
  assert.equal(serialized.includes("0 * * * *"), false);
});

test("bounded duplicate evidence promises only two conflicting variants when three are observed", () => {
  const jobs = Array.from({ length: 33 }, (_, index) => ({
    source: "/etc/cron.d/private-three-variant-job",
    schedule: index === 31 ? "15 * * * *" : index === 32 ? "30 * * * *" : "0 * * * *",
    commandSummary: "command content intentionally not collected",
  }));

  const findings = createServerAuditScheduledJobFindings(snapshot(jobs));
  const conflict = findings.find((finding) => finding.title === "Scheduled-job inventory reports conflicting duplicate evidence");

  assert.equal(findings.length, 1);
  assert.equal(conflict?.evidence.length, 32);
  assert.equal(conflict?.evidence[0]?.source, "scheduledJobs[0]");
  assert.equal(conflict?.evidence[31]?.source, "scheduledJobs[31]");
  assert.equal(conflict?.evidence.some((item) => item.source === "scheduledJobs[32]"), false);
  assert.match(conflict?.summary ?? "", /preserving at least two conflicting metadata variants/);
  assert.equal((conflict?.summary ?? "").includes("preserving all observed metadata variants"), false);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-three-variant-job"), false);
  assert.equal(serialized.includes("30 * * * *"), false);
});

test("scheduled-job findings are deterministic and bounded", () => {
  const jobs = Array.from({ length: 10 }, (_, index) => ({
    source: `/etc/cron.d/private-${index}`,
    commandSummary: `secret-command-${index}`,
  }));
  const input = snapshot(jobs);
  const first = createServerAuditScheduledJobFindings(input, { maxFindings: 4 });
  const second = createServerAuditScheduledJobFindings(input, { maxFindings: 4 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.equal(first.filter((finding) => finding.title === "Scheduled-job findings were truncated").length, 1);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  assert.equal(JSON.stringify(first).includes("secret-command"), false);
  assert.equal(JSON.stringify(first).includes("private-"), false);
});

test("scheduled-job finding retention stays bounded across 5,000 privacy candidates", () => {
  const jobs = Array.from({ length: 5_000 }, (_, index) => ({
    source: `/etc/cron.d/private-${index}`,
    commandSummary: `secret-command-${index}`,
  }));

  const findings = createServerAuditScheduledJobFindings(snapshot(jobs), { maxFindings: 1_000 });
  const limitation = findings.find((finding) => finding.title === "Scheduled-job findings were truncated");

  assert.equal(findings.length, 1_000);
  assert.equal(findings.filter((finding) => finding.category === "privacy").length, 999);
  assert.equal(findings[findings.length - 1]?.title, "Scheduled-job findings were truncated");
  assert.match(limitation?.summary ?? "", /produced 5000 findings/);
  assert.match(limitation?.summary ?? "", /first 999 deterministic findings/);
  assert.equal(limitation?.evidence[0]?.source, "scheduledJobs");
  assert.equal(limitation?.evidence[0]?.summary, "finding limit 1000 reached");
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("secret-command-4999"), false);
  assert.equal(serialized.includes("private-4999"), false);
});

test("scheduled-job option bounds fail closed", () => {
  assert.throws(() => createServerAuditScheduledJobFindings(snapshot([]), { maxFindings: 0 }), /maxFindings/);
  assert.throws(() => createServerAuditScheduledJobFindings(snapshot([]), { maxFindings: 1001 }), /maxFindings/);
});
