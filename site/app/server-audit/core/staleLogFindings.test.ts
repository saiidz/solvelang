import assert from "node:assert/strict";
import test from "node:test";

import { createServerAuditStaleLogFindings } from "./staleLogFindings";
import { createServerAuditReport } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T12:00:00.000Z",
    host: { hostname: "audit-host" },
    logs: [
      { path: "/var/log/private-app.log", modifiedAt: "2026-08-12T11:59:59.000Z" },
      { path: "/var/log/recent-app.log", modifiedAt: "2026-08-20T11:00:00.000Z" },
      { path: "/var/log/unknown-time.log" },
      { path: "/var/log/invalid-time.log", modifiedAt: "not-a-timestamp" },
      { path: "/var/log/future-time.log", modifiedAt: "2026-08-21T12:00:00.000Z" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("stale log candidates use only bounded timestamp metadata and withhold paths", () => {
  const findings = createServerAuditStaleLogFindings(snapshot());

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.title, "Log activity appears stale relative to the snapshot");
  assert.deepEqual(findings[0]?.evidence, [{ source: "logs[0].modifiedAt", summary: "older than 168 hours" }]);
  assert.match(findings[0]?.summary ?? "", /candidate/i);
  const serialized = JSON.stringify(findings);
  for (const privateValue of ["/var/log", "not-a-timestamp", "2026-08-12"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("stale log candidates are deterministic and bounded", () => {
  const input = snapshot();
  input.logs = Array.from({ length: 8 }, (_, index) => ({
    path: `/var/log/private-${index}.log`,
    modifiedAt: "2026-08-01T00:00:00.000Z",
  }));

  const first = createServerAuditStaleLogFindings(input, { staleAfterHours: 1, maxFindings: 3 });
  const second = createServerAuditStaleLogFindings(structuredClone(input), { staleAfterHours: 1, maxFindings: 3 });
  assert.deepEqual(first, second);
  assert.equal(first.length, 3);
  assert.equal(first.filter((entry) => entry.title === "Stale-log candidates were truncated").length, 1);
});

test("stale log options fail closed and canonical reports compose the redacted candidates", () => {
  const input = snapshot();
  assert.throws(() => createServerAuditStaleLogFindings(input, { maxFindings: 0 }), /stale-log maxFindings/);
  assert.throws(() => createServerAuditStaleLogFindings(input, { staleAfterHours: 0 }), /stale-log staleAfterHours/);

  const report = createServerAuditReport(input, "2026-08-20T13:00:00.000Z");
  const findings = report.findings.filter((entry) => entry.title === "Log activity appears stale relative to the snapshot");
  assert.equal(findings.length, 1);
  assert.equal(JSON.stringify(report).includes("/var/log/private-app.log"), false);
});
