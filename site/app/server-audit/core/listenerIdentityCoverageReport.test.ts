import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithBlankListenerIdentities(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T23:45:00.000Z",
    host: { hostname: "audit-host" },
    listeningSockets: [
      { protocol: " \t ", localAddress: "\n", port: 443, process: "private-listener-process" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 8443, process: "private-valid-process" },
    ],
  };
}

test("canonical reports compose listener identity coverage with structural evidence only", () => {
  const report = createServerAuditReport(snapshotWithBlankListenerIdentities(), "2026-08-20T23:46:00.000Z");

  const protocol = report.findings.filter((finding) => finding.title === "Listening socket record lacks a usable protocol identity");
  const address = report.findings.filter((finding) => finding.title === "Listening socket record lacks a usable local-address identity");

  assert.equal(protocol.length, 1);
  assert.equal(address.length, 1);
  assert.deepEqual(protocol[0].evidence, [{
    source: "listeningSockets[0].protocol",
    summary: "listener protocol identity is empty after normalization",
  }]);
  assert.deepEqual(address[0].evidence, [{
    source: "listeningSockets[0].localAddress",
    summary: "listener local-address identity is empty after normalization",
  }]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of ["private-listener-process", "private-valid-process", "127.0.0.1"]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  assert.ok(report.limitations.some((item) => item.includes("Listener-identity coverage findings")));
});
