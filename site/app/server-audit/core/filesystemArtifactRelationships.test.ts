import assert from "node:assert/strict";
import test from "node:test";
import { analyzeServerAuditFilesystemArtifactRelationships } from "./filesystemArtifactRelationships";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T20:00:00.000Z",
    host: { hostname: "audit-host" },
    filesystems: [
      { mount: "/", sizeBytes: 1_000 },
      { mount: "/var", sizeBytes: 500 },
      { mount: "/var/lib", sizeBytes: 250 },
    ],
    logs: [
      { path: "/var/log/private-app.log", sizeBytes: 10 },
      { path: "/var/lib/private-worker/log.txt", sizeBytes: 20 },
    ],
    backups: [
      { name: "private-backup", path: "/srv/backups/private.tar", sizeBytes: 30 },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("filesystem-artifact analysis chooses the most-specific lexical mount without emitting raw paths", () => {
  const analysis = analyzeServerAuditFilesystemArtifactRelationships(snapshot());

  assert.equal(analysis.summary.filesystemsChecked, 3);
  assert.equal(analysis.summary.logsChecked, 2);
  assert.equal(analysis.summary.backupsChecked, 1);
  assert.equal(analysis.summary.mappedLogs, 2);
  assert.equal(analysis.summary.mappedBackups, 1);
  assert.equal(analysis.summary.ambiguousLogs, 0);
  assert.equal(analysis.summary.ambiguousBackups, 0);
  assert.equal(analysis.execution.pathResolution, "lexical-posix-only");
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);

  assert.ok(analysis.relationships.some((entry) =>
    entry.kind === "filesystem-log"
    && entry.sources.includes("filesystems[1]")
    && entry.sources.includes("logs[0]")));
  assert.ok(analysis.relationships.some((entry) =>
    entry.kind === "filesystem-log"
    && entry.sources.includes("filesystems[2]")
    && entry.sources.includes("logs[1]")));
  assert.ok(analysis.relationships.some((entry) =>
    entry.kind === "filesystem-backup"
    && entry.sources.includes("filesystems[0]")
    && entry.sources.includes("backups[0]")));

  const serialized = JSON.stringify(analysis);
  for (const sensitive of ["private-app", "private-worker", "private-backup", "/var/log", "/srv/backups"]) {
    assert.equal(serialized.includes(sensitive), false);
  }
});

test("duplicate equally-specific mounts produce an explicit bounded ambiguity", () => {
  const input = snapshot();
  input.filesystems = [
    { mount: "/" },
    { mount: "/var" },
    { mount: "/var/" },
  ];
  input.logs = [{ path: "/var/log/app.log" }];
  input.backups = [];

  const analysis = analyzeServerAuditFilesystemArtifactRelationships(input);
  assert.equal(analysis.relationships.length, 1);
  assert.equal(analysis.relationships[0].kind, "ambiguous-filesystem-log");
  assert.deepEqual(analysis.relationships[0].sources, ["filesystems[1]", "filesystems[2]", "logs[0]"]);
  assert.equal(analysis.summary.ambiguousLogs, 1);
  assert.equal(analysis.summary.mappedLogs, 0);
});

test("invalid or unresolved paths are skipped conservatively instead of being guessed", () => {
  const input = snapshot();
  input.filesystems = [
    { mount: "relative" },
    { mount: "/safe" },
  ];
  input.logs = [
    { path: "relative.log" },
    { path: "/safe/../private.log" },
    { path: "/outside/log.txt" },
  ];
  input.backups = [
    { name: "missing-path" },
  ];

  const analysis = analyzeServerAuditFilesystemArtifactRelationships(input);
  assert.deepEqual(analysis.relationships, []);
  assert.equal(analysis.summary.skippedInvalidMountPaths, 1);
  assert.equal(analysis.summary.skippedInvalidArtifactPaths, 3);
  assert.equal(analysis.summary.unresolvedArtifacts, 1);
});

test("filesystem-artifact output is deterministic and relationship-bounded", () => {
  const input = snapshot();
  const first = analyzeServerAuditFilesystemArtifactRelationships(input, { maxRelationships: 1 });
  const second = analyzeServerAuditFilesystemArtifactRelationships(input, { maxRelationships: 1 });

  assert.deepEqual(first, second);
  assert.equal(first.relationships.length, 1);
  assert.equal(first.execution.relationshipsTruncated, true);
  assert.ok(first.relationships.every((entry) => /^server-filesystem-artifact:[a-f0-9]{8}$/.test(entry.id)));
  assert.throws(
    () => analyzeServerAuditFilesystemArtifactRelationships(input, { maxRelationships: 0 }),
    /filesystem-artifact maxRelationships/,
  );
});

test("relationship sources are capped while preserving truncation truth", () => {
  const input = snapshot();
  input.filesystems = Array.from({ length: 40 }, () => ({ mount: "/var" }));
  input.logs = [{ path: "/var/log/app.log" }];
  input.backups = [];

  const analysis = analyzeServerAuditFilesystemArtifactRelationships(input);
  assert.equal(analysis.relationships.length, 1);
  assert.equal(analysis.relationships[0].kind, "ambiguous-filesystem-log");
  assert.equal(analysis.relationships[0].sources.length, analysis.execution.maxSourcesPerRelationship);
  assert.equal(analysis.relationships[0].sourcesTruncated, true);
  assert.equal(analysis.summary.relationshipsWithTruncatedSources, 1);
});
