import assert from "node:assert/strict";
import test from "node:test";
import { analyzeServerSnapshot } from "./analyze";
import { createServerAuditReport } from "./report";
import { parseServerAuditSnapshot } from "./snapshot";
import type { ServerAuditSnapshot } from "./types";

function risky(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-15T05:00:00.000Z",
    host: { hostname: "prod-1", os: "Ubuntu 24.04", kernel: "6.8", architecture: "x64" },
    filesystems: [{ mount: "/", usagePercent: 96 }],
    listeningSockets: [
      { protocol: "tcp", localAddress: "0.0.0.0", port: 3306, process: "mysqld" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 6379, process: "redis" },
    ],
    services: [{ name: "worker.service", state: "failed failed" }],
    web: {
      roots: [{ path: "/var/www/app", owner: "root", mode: "0777", frameworkHints: ["Laravel"] }],
      certificates: [{ name: "api.example.com", daysRemaining: 4 }],
    },
    backups: [],
    logs: [{ path: "/var/log/app.log", sizeBytes: 6 * 1024 * 1024 * 1024 }],
    security: {
      firewall: "inactive",
      automaticUpdates: "disabled",
      rootSshLogin: "yes",
      passwordSshLogin: "yes",
    },
    metadata: { redactionsApplied: true },
  };
}

test("analysis surfaces high-signal risks without treating private listeners as public", () => {
  const findings = analyzeServerSnapshot(risky());
  const titles = findings.map((finding) => finding.title);
  assert.ok(titles.includes("Filesystem critically full"));
  assert.ok(titles.includes("MySQL/MariaDB listens on all interfaces"));
  assert.ok(!findings.some((finding) => finding.summary.includes("6379") && finding.title.includes("listens on all interfaces")));
  assert.ok(titles.includes("Root SSH login is not disabled"));
  assert.ok(titles.includes("Host firewall not reported active"));
  assert.ok(titles.includes("TLS certificate expires within seven days"));
  assert.ok(titles.includes("Web root is world-writable"));
  assert.ok(titles.includes("No backup evidence collected"));
  assert.ok(titles.includes("Very large log file"));
  assert.ok(titles.includes("Service is not healthy"));
  assert.ok(findings.every((finding) => /^srv_[a-f0-9]{8}$/.test(finding.id)));
});

test("TLS baseline findings use structural certificate evidence without exporting certificate identities", () => {
  const privateName = "private-admin.example.internal";
  const findings = analyzeServerSnapshot({
    schemaVersion: "1",
    collectedAt: "2026-08-18T17:00:00.000Z",
    host: { hostname: "audit-host" },
    web: { certificates: [{ name: privateName, daysRemaining: 4 }] },
    metadata: { redactionsApplied: true },
  });

  const tls = findings.find((finding) => finding.title === "TLS certificate expires within seven days");
  assert.ok(tls);
  assert.equal(JSON.stringify(tls).includes(privateName), false);
  assert.deepEqual(tls.evidence, [
    { source: "web.certificates[0].daysRemaining", summary: "4 days remaining" },
  ]);
});

test("baseline analysis skips unavailable sparse web-root records", () => {
  const roots = Array<{ path: string }>(1);
  const findings = analyzeServerSnapshot({
    schemaVersion: "1",
    collectedAt: "2026-08-20T13:00:00.000Z",
    host: { hostname: "audit-host" },
    web: { roots },
    metadata: { redactionsApplied: true },
  });

  assert.equal(findings.some((finding) => finding.category === "permissions"), false);
});

test("report generation is deterministic for the same snapshot regardless of generation time", () => {
  const first = createServerAuditReport(risky(), "2026-08-15T06:00:00.000Z");
  const second = createServerAuditReport(risky(), "2026-08-15T07:00:00.000Z");
  assert.equal(first.reportId, second.reportId);
  assert.deepEqual(first.findings.map((finding) => finding.id), second.findings.map((finding) => finding.id));
  assert.equal(first.summary.critical > 0, true);
  assert.equal(first.summary.score < 100, true);
});

test("snapshot parser rejects unknown fields, unsafe shapes, oversized lists, malformed ports, and unsupported versions", () => {
  const base = JSON.stringify({ schemaVersion: "1", collectedAt: "2026-08-15T05:00:00Z", host: { hostname: "prod-1" }, metadata: { redactionsApplied: true } });
  assert.equal(parseServerAuditSnapshot(base).host.hostname, "prod-1");

  assert.throws(() => parseServerAuditSnapshot(JSON.stringify({ schemaVersion: "2", collectedAt: "2026-08-15T05:00:00Z", host: { hostname: "prod-1" } })), /Unsupported/);
  assert.throws(() => parseServerAuditSnapshot(JSON.stringify({ schemaVersion: "1", collectedAt: "2026-08-15T05:00:00Z", host: { hostname: "prod-1" }, secret: "oops" })), /unknown field/);
  assert.throws(() => parseServerAuditSnapshot(JSON.stringify({ schemaVersion: "1", collectedAt: "2026-08-15T05:00:00Z", host: { hostname: "prod-1" }, listeningSockets: [{ protocol: "tcp", localAddress: "0.0.0.0", port: 70000 }] })), /port is invalid/);
  assert.throws(() => parseServerAuditSnapshot(JSON.stringify({ schemaVersion: "1", collectedAt: "2026-08-15T05:00:00Z", host: { hostname: "not a host!" } })), /hostname is invalid/);
});