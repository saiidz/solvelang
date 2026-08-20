import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithBlankWebIdentities(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T13:00:00.000Z",
    host: { hostname: "audit-host" },
    web: {
      servers: ["   ", "private-nginx"],
      roots: [
        { path: "\t", owner: "1000", mode: "0750" },
        { path: "/private/valid-root", owner: "1000", mode: "0750" },
      ],
    },
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose unusable web identities using structural evidence only", () => {
  const report = createServerAuditReport(snapshotWithBlankWebIdentities(), "2026-08-20T13:01:00.000Z");
  const coverage = report.findings.filter((finding) => [
    "Web-server record lacks a usable identity",
    "Web-root record lacks a usable path identity",
  ].includes(finding.title));

  assert.equal(coverage.length, 2);
  assert.deepEqual(coverage.flatMap((finding) => finding.evidence.map((evidence) => evidence.source)).sort(), [
    "web.roots[0].path",
    "web.servers[0]",
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of ["private-nginx", "/private/valid-root", "1000", "0750"]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }
  assert.ok(report.limitations.some((item) => item.includes("Web-identity coverage findings")));
});
