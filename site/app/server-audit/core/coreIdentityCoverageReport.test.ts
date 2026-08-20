import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithBlankCoreIdentities(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T23:00:00.000Z",
    host: { hostname: "audit-host" },
    services: [
      { name: "   ", state: "active running", enabled: "enabled" },
      { name: "private-valid.service", state: "active running", enabled: "enabled" },
    ],
    processes: [
      { pid: 101, ppid: 1, uid: 1000, state: "S", name: "\t" },
      { pid: 102, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
    ],
    packages: [
      { name: "\n", version: "1.0.0" },
      { name: "private-package", version: "9.9.9-private" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose core identity coverage with structural evidence only", () => {
  const report = createServerAuditReport(snapshotWithBlankCoreIdentities(), "2026-08-20T23:01:00.000Z");

  const service = report.findings.filter((finding) => finding.title === "Service record lacks a usable identity");
  const process = report.findings.filter((finding) => finding.title === "Process record lacks a usable identity");
  const pkg = report.findings.filter((finding) => finding.title === "Package record lacks a usable identity");

  assert.equal(service.length, 1);
  assert.equal(process.length, 1);
  assert.equal(pkg.length, 1);
  assert.deepEqual(service[0].evidence, [{
    source: "services[0].name",
    summary: "service identity is empty after normalization",
  }]);
  assert.deepEqual(process[0].evidence, [{
    source: "processes[0].name",
    summary: "process identity is empty after normalization",
  }]);
  assert.deepEqual(pkg[0].evidence, [{
    source: "packages[0].name",
    summary: "package identity is empty after normalization",
  }]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of ["private-valid.service", "private-worker", "private-package", "9.9.9-private"]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  assert.ok(report.limitations.some((item) => item.includes("Service-identity coverage findings")));
  assert.ok(report.limitations.some((item) => item.includes("Process-identity coverage findings")));
  assert.ok(report.limitations.some((item) => item.includes("Package-identity coverage findings")));
});
