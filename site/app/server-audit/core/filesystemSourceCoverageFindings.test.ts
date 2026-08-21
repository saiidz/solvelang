import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditFilesystemSourceCoverageFindings } from "./filesystemSourceCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(filesystems: NonNullable<ServerAuditSnapshot["filesystems"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T06:05:00.000Z",
    host: { hostname: "audit-host" },
    filesystems,
    metadata: { redactionsApplied: true },
  };
}

test("filesystem source coverage reports absent and blank source identities structurally", () => {
  const findings = createServerAuditFilesystemSourceCoverageFindings(snapshot([
    { mount: "/private-a", filesystem: "/dev/private-a" },
    { mount: "/private-b" },
    { mount: "/private-c", filesystem: "   " },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Filesystem source identity evidence is incomplete");
  assert.equal(findings[0].severity, "info");
  assert.equal(findings[0].category, "coverage");
  assert.ok(findings[0].summary.includes("2 of 3 supplied filesystem record(s)"));
  assert.deepEqual(findings[0].evidence, [
    { source: "filesystems[1].filesystem", summary: "filesystem source identity missing" },
    { source: "filesystems[2].filesystem", summary: "filesystem source identity missing" },
  ]);

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-a"), false);
  assert.equal(serialized.includes("private-b"), false);
  assert.equal(serialized.includes("private-c"), false);
  assert.equal(serialized.includes("/dev/private-a"), false);
});

test("filesystem source coverage leaves absent, empty, and usable inventories to existing stages", () => {
  const absent: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-21T06:05:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  };

  assert.deepEqual(createServerAuditFilesystemSourceCoverageFindings(absent), []);
  assert.deepEqual(createServerAuditFilesystemSourceCoverageFindings(snapshot([])), []);
  assert.deepEqual(createServerAuditFilesystemSourceCoverageFindings(snapshot([
    { mount: "/private-a", filesystem: "overlay" },
    { mount: "/private-b", filesystem: "/dev/xvda1" },
  ])), []);
});

test("filesystem source coverage is deterministic and bounds structural evidence", () => {
  const filesystems = Array.from({ length: 150 }, (_, index) => ({
    mount: `/private-${index}`,
  }));

  const first = createServerAuditFilesystemSourceCoverageFindings(snapshot(filesystems));
  const second = createServerAuditFilesystemSourceCoverageFindings(snapshot(filesystems));

  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0].evidence.length, 100);
  assert.deepEqual(first[0].evidence[0], {
    source: "filesystems[0].filesystem",
    summary: "filesystem source identity missing",
  });
  assert.deepEqual(first[0].evidence[99], {
    source: "filesystems[99].filesystem",
    summary: "filesystem source identity missing",
  });
  assert.ok(first[0].summary.includes("150 of 150 supplied filesystem record(s)"));
  assert.ok(first[0].summary.includes("Only the first 100 structural reference(s) are included."));
  assert.equal(JSON.stringify(first).includes("private-149"), false);
});
