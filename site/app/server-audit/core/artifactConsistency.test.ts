import assert from "node:assert/strict";
import test from "node:test";
import { analyzeServerAuditArtifactConsistency } from "./artifactConsistency";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T15:00:00.000Z",
    host: { hostname: "audit-host" },
    backups: [
      { name: "private-nightly-a", path: "/srv/private/backups/app.tar", ageHours: 10, sizeBytes: 100 },
      { name: "private-nightly-b", path: "/srv/private/backups/app.tar", ageHours: 12, sizeBytes: 120 },
    ],
    logs: [
      { path: "/var/log/private-app.log", sizeBytes: 1000, modifiedAt: "2026-08-18T14:00:00.000Z" },
      { path: "/var/log/private-app.log", sizeBytes: 1500, modifiedAt: "2026-08-18T14:05:00.000Z" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("artifact consistency reports conflicting backup and log evidence without raw identifiers", () => {
  const analysis = analyzeServerAuditArtifactConsistency(snapshot());

  assert.deepEqual(
    analysis.issues.map((issue) => issue.kind).sort(),
    ["conflicting-backup-metadata", "conflicting-log-metadata"].sort(),
  );
  assert.equal(analysis.summary.backupsChecked, 2);
  assert.equal(analysis.summary.logsChecked, 2);
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);

  const serialized = JSON.stringify(analysis.issues);
  assert.equal(serialized.includes("private-nightly"), false);
  assert.equal(serialized.includes("/srv/private/backups/app.tar"), false);
  assert.equal(serialized.includes("/var/log/private-app.log"), false);
  assert.ok(serialized.includes("backups[0]"));
  assert.ok(serialized.includes("logs[0]"));
});

test("identical duplicate artifacts and pathless backups do not create false conflicts", () => {
  const input = snapshot();
  input.backups = [
    { name: "same", path: "/backups/same.tar", ageHours: 10, sizeBytes: 100 },
    { name: "same", path: "/backups/same.tar", ageHours: 10, sizeBytes: 100 },
    { name: "pathless-a", ageHours: 1, sizeBytes: 10 },
    { name: "pathless-b", ageHours: 2, sizeBytes: 20 },
  ];
  input.logs = [
    { path: "/logs/same.log", sizeBytes: 1000, modifiedAt: "2026-08-18T14:00:00.000Z" },
    { path: "/logs/same.log", sizeBytes: 1000, modifiedAt: "2026-08-18T14:00:00.000Z" },
  ];

  assert.deepEqual(analyzeServerAuditArtifactConsistency(input).issues, []);
});

test("artifact consistency output is deterministic and bounded", () => {
  const input = snapshot();
  input.backups = [
    { name: "a1", path: "/b/a", ageHours: 1, sizeBytes: 1 },
    { name: "a2", path: "/b/a", ageHours: 2, sizeBytes: 2 },
    { name: "b1", path: "/b/b", ageHours: 1, sizeBytes: 1 },
    { name: "b2", path: "/b/b", ageHours: 2, sizeBytes: 2 },
  ];
  input.logs = [
    { path: "/l/a", sizeBytes: 1, modifiedAt: "2026-08-18T14:00:00.000Z" },
    { path: "/l/a", sizeBytes: 2, modifiedAt: "2026-08-18T14:01:00.000Z" },
  ];

  const first = analyzeServerAuditArtifactConsistency(input, { maxIssues: 2 });
  const second = analyzeServerAuditArtifactConsistency(input, { maxIssues: 2 });

  assert.deepEqual(first, second);
  assert.equal(first.issues.length, 2);
  assert.equal(first.execution.issuesTruncated, true);
  assert.throws(
    () => analyzeServerAuditArtifactConsistency(input, { maxIssues: 0 }),
    /artifact maxIssues/,
  );
});

test("artifact consistency bounds structural sources while retaining a late conflicting witness", () => {
  const input = snapshot();
  input.logs = [];
  input.backups = Array.from({ length: 40 }, (_, index) => ({
    name: "private-backup",
    path: "/private/backups/same.dump",
    ageHours: index === 39 ? 2 : 1,
    sizeBytes: index === 39 ? 11 : 10,
  }));

  const analysis = analyzeServerAuditArtifactConsistency(input, { maxSourcesPerIssue: 2 });

  assert.equal(analysis.issues.length, 1);
  assert.deepEqual(analysis.issues[0].sources, ["backups[0]", "backups[39]"]);
  assert.equal(analysis.issues[0].sourceCount, 40);
  assert.equal(analysis.issues[0].sourcesTruncated, true);
  assert.equal(analysis.execution.issueSourcesTruncated, true);
  assert.equal(JSON.stringify(analysis).includes("private-backup"), false);
  assert.equal(JSON.stringify(analysis).includes("/private/backups/same.dump"), false);
  assert.throws(
    () => analyzeServerAuditArtifactConsistency(input, { maxSourcesPerIssue: 1 }),
    /artifact maxSourcesPerIssue.*2 through 256/,
  );
});
