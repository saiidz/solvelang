import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditLogCoverageFindings } from "./logCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(logs: NonNullable<ServerAuditSnapshot["logs"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T14:00:00.000Z",
    host: { hostname: "audit-host" },
    logs,
    metadata: { redactionsApplied: true },
  };
}

test("log coverage reports missing timestamp and size evidence without path leakage", () => {
  const findings = createServerAuditLogCoverageFindings(snapshot([
    { path: "/private/customer-a.log" },
    { path: "/private/complete.log", modifiedAt: "2026-08-20T13:00:00.000Z", sizeBytes: 1024 },
  ]));

  assert.equal(findings.length, 2);
  const activity = findings.find((finding) => finding.title === "Log record lacks activity timestamp evidence");
  const size = findings.find((finding) => finding.title === "Log record lacks size evidence");
  assert.ok(activity);
  assert.ok(size);
  assert.deepEqual(activity.evidence, [{ source: "logs[0].modifiedAt", summary: "activity timestamp evidence is absent" }]);
  assert.deepEqual(size.evidence, [{ source: "logs[0].sizeBytes", summary: "size evidence is absent" }]);
  assert.equal(JSON.stringify(findings).includes("/private/customer-a.log"), false);
});

test("log coverage reports explicit empty inventory but leaves absent section to generic coverage", () => {
  const empty = createServerAuditLogCoverageFindings(snapshot([]));
  assert.equal(empty.length, 1);
  assert.equal(empty[0].title, "No log records supplied");

  const absent: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T14:00:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  };
  assert.deepEqual(createServerAuditLogCoverageFindings(absent), []);
});

test("log coverage reports only the missing dimension", () => {
  const findings = createServerAuditLogCoverageFindings(snapshot([
    { path: "/private/timestamp-only.log", modifiedAt: "2026-08-20T13:00:00.000Z" },
    { path: "/private/size-only.log", sizeBytes: 1024 },
  ]));

  assert.equal(findings.length, 2);
  assert.ok(findings.some((finding) => finding.evidence[0]?.source === "logs[0].sizeBytes"));
  assert.ok(findings.some((finding) => finding.evidence[0]?.source === "logs[1].modifiedAt"));
});

test("log coverage output is deterministic and bounded", () => {
  const logs = Array.from({ length: 105 }, (_, index) => ({ path: `/private/log-${index}.log` }));
  const first = createServerAuditLogCoverageFindings(snapshot(logs), { maxFindings: 10 });
  const second = createServerAuditLogCoverageFindings(snapshot(logs), { maxFindings: 10 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 10);
  assert.equal(first.filter((finding) => finding.title === "Log evidence coverage findings were truncated").length, 1);
  assert.equal(JSON.stringify(first).includes("/private/log-104.log"), false);
  assert.throws(() => createServerAuditLogCoverageFindings(snapshot(logs), { maxFindings: 0 }), /log-coverage maxFindings/);
});

test("log coverage retention stays bounded at maximum supported finding output", () => {
  const logs = Array.from({ length: 5_000 }, (_, index) => ({ path: `/private/log-${index}.log` }));
  const input = snapshot(logs);
  const first = createServerAuditLogCoverageFindings(input, { maxFindings: 1_000 });
  const second = createServerAuditLogCoverageFindings(structuredClone(input), { maxFindings: 1_000 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 1_000);
  assert.equal(first.filter((finding) => finding.category === "coverage").length, 1_000);
  const limitation = first.find((finding) => finding.title === "Log evidence coverage findings were truncated");
  assert.ok(limitation);
  assert.match(limitation.summary, /produced 10000 findings/);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  assert.equal(JSON.stringify(first).includes("/private/log-"), false);
});
