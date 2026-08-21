import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithIncompleteWebRootPermissions(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T05:20:00.000Z",
    host: { hostname: "audit-host" },
    web: {
      roots: [
        { path: "/srv/private-owner-gap", mode: "0701" },
        { path: "/srv/private-mode-gap", owner: "private-owner-BRAVO" },
        { path: "/srv/private-complete", owner: "private-owner-CHARLIE", mode: "0751" },
      ],
    },
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose web-root ownership and permission coverage with structural evidence only", () => {
  const report = createServerAuditReport(
    snapshotWithIncompleteWebRootPermissions(),
    "2026-08-21T05:21:00.000Z",
  );
  const findings = report.findings.filter(
    (finding) => finding.title === "Web-root ownership or permission evidence is incomplete",
  );

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].evidence, [
    { source: "web.roots[0].owner", summary: "owner missing or blank" },
    { source: "web.roots[1].mode", summary: "mode missing" },
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of [
    "/srv/private-owner-gap",
    "/srv/private-mode-gap",
    "/srv/private-complete",
    "private-owner-BRAVO",
    "private-owner-CHARLIE",
    "0701",
    "0751",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  assert.ok(json.includes("web.roots[0].owner"));
  assert.ok(json.includes("web.roots[1].mode"));
  assert.ok(html.includes("web.roots[0].owner"));
  assert.ok(html.includes("web.roots[1].mode"));
  assert.ok(report.limitations.some((item) => item.includes("Web-root ownership/permission coverage findings")));
});
