import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditFilesystemUsageFindings } from "./filesystemUsageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(filesystems: NonNullable<ServerAuditSnapshot["filesystems"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T05:30:00.000Z",
    host: { hostname: "audit-host" },
    filesystems,
    metadata: { redactionsApplied: true },
  };
}

test("filesystem usage findings preserve thresholds with structural evidence only", () => {
  const findings = createServerAuditFilesystemUsageFindings(snapshot([
    { mount: "/private-safe", usagePercent: 79 },
    { mount: "/private-medium", usagePercent: 80 },
    { mount: "/private-high", usagePercent: 90 },
    { mount: "/private-critical", usagePercent: 95 },
  ]));

  assert.deepEqual(findings.map((finding) => finding.title), [
    "Filesystem critically full",
    "Filesystem nearly full",
    "Filesystem usage elevated",
  ]);
  assert.deepEqual(findings.map((finding) => finding.evidence), [
    [{ source: "filesystems[3].usagePercent", summary: "95% used" }],
    [{ source: "filesystems[2].usagePercent", summary: "90% used" }],
    [{ source: "filesystems[1].usagePercent", summary: "80% used" }],
  ]);

  const serialized = JSON.stringify(findings);
  for (const privateValue of ["/private-safe", "/private-medium", "/private-high", "/private-critical"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("filesystem usage findings are deterministic and bound high-cardinality evidence", () => {
  const filesystems = Array.from({ length: 150 }, (_, index) => ({
    mount: `/private-${index}`,
    usagePercent: 95,
  }));

  const first = createServerAuditFilesystemUsageFindings(snapshot(filesystems));
  const second = createServerAuditFilesystemUsageFindings(snapshot(filesystems));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  assert.equal(first.some((finding) => finding.title === "Filesystem usage findings were truncated"), true);
  assert.equal(JSON.stringify(first).includes("/private-149"), false);
  assert.ok(first.every((finding) => /^srv_[a-f0-9]{8}$/.test(finding.id)));
});

test("filesystem usage retention stays bounded across a 5,000-record critical inventory", () => {
  const filesystems = Array.from({ length: 5_000 }, (_, index) => ({
    mount: `/private-${index}`,
    usagePercent: 95,
  }));
  const input = snapshot(filesystems);
  const first = createServerAuditFilesystemUsageFindings(input);
  const second = createServerAuditFilesystemUsageFindings(structuredClone(input));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  assert.equal(first.filter((finding) => finding.title === "Filesystem critically full").length, 99);
  const limitation = first.find((finding) => finding.title === "Filesystem usage findings were truncated");
  assert.ok(limitation);
  assert.match(limitation.summary, /produced 5000 findings/);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  assert.equal(JSON.stringify(first).includes("/private-"), false);
});

test("filesystem usage findings ignore missing and sub-threshold utilization", () => {
  assert.deepEqual(createServerAuditFilesystemUsageFindings(snapshot([
    { mount: "/private-missing" },
    { mount: "/private-ok", usagePercent: 65 },
  ])), []);
});
