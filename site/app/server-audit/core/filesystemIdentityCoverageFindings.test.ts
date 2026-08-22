import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditFilesystemIdentityCoverageFindings } from "./filesystemIdentityCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(filesystems: NonNullable<ServerAuditSnapshot["filesystems"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T00:30:00.000Z",
    host: { hostname: "audit-host" },
    filesystems,
    metadata: { redactionsApplied: true },
  };
}

test("filesystem identity coverage reports blank normalized mounts using structural evidence only", () => {
  const findings = createServerAuditFilesystemIdentityCoverageFindings(snapshot([
    { mount: "   ", filesystem: "private-fs-a", sizeBytes: 100 },
    { mount: "\t", filesystem: "private-fs-b", sizeBytes: 200 },
    { mount: "/srv/private-valid", filesystem: "private-fs-c", sizeBytes: 300 },
  ]));

  assert.equal(findings.length, 2);
  assert.equal(findings[0]?.id, "srv_45bd35e2");
  assert.equal(findings.every((finding) => finding.severity === "info"), true);
  assert.equal(findings.every((finding) => finding.category === "coverage"), true);
  assert.equal(findings.every((finding) => finding.title === "Filesystem record lacks a usable mount identity"), true);
  assert.deepEqual(findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source)).sort(), [
    "filesystems[0].mount",
    "filesystems[1].mount",
  ]);

  const serialized = JSON.stringify(findings);
  for (const privateValue of ["private-fs-a", "private-fs-b", "private-fs-c", "/srv/private-valid"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("filesystem identity coverage treats normalized non-empty mount identities as usable", () => {
  assert.deepEqual(createServerAuditFilesystemIdentityCoverageFindings(snapshot([
    { mount: " / ", filesystem: "rootfs" },
    { mount: "/srv/é", filesystem: "data-a" },
    { mount: "/srv/e\u0301", filesystem: "data-b" },
  ])), []);
});

test("filesystem identity coverage output is deterministic and bounded", () => {
  const filesystems = Array.from({ length: 105 }, (_, index) => ({
    mount: "   ",
    filesystem: `private-${index}`,
    sizeBytes: index + 1,
  }));
  const first = createServerAuditFilesystemIdentityCoverageFindings(snapshot(filesystems));
  const second = createServerAuditFilesystemIdentityCoverageFindings(snapshot(filesystems));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  const identityFindings = first.filter((finding) => finding.title === "Filesystem record lacks a usable mount identity");
  assert.equal(identityFindings.length, 99);
  assert.equal(first.filter((finding) => finding.title === "Filesystem identity coverage findings were truncated").length, 1);
  const structuralSources = identityFindings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source));
  assert.equal(new Set(structuralSources).size, 99);
  assert.equal(structuralSources.every((source) => /^filesystems\[\d+\]\.mount$/.test(source)), true);
});

test("filesystem identity coverage materializes only bounded findings for high-cardinality identity gaps", () => {
  const filesystems = Array.from({ length: 5_000 }, (_, index) => ({
    mount: "   ",
    filesystem: `private-filesystem-${index}`,
    sizeBytes: index + 1,
  }));

  const findings = createServerAuditFilesystemIdentityCoverageFindings(snapshot(filesystems));

  assert.equal(findings.length, 100);
  assert.equal(findings.filter((finding) => finding.title === "Filesystem record lacks a usable mount identity").length, 99);
  assert.equal(findings.filter((finding) => finding.title === "Filesystem identity coverage findings were truncated").length, 1);
  assert.equal(JSON.stringify(findings).includes("private-filesystem-"), false);
});

test("filesystem identity coverage emits no finding when filesystem evidence is absent", () => {
  assert.deepEqual(createServerAuditFilesystemIdentityCoverageFindings({
    schemaVersion: "1",
    collectedAt: "2026-08-21T00:30:00.000Z",
    host: { hostname: "audit-host" },
  }), []);
});
