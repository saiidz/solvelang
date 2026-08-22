import assert from "node:assert/strict";
import test from "node:test";
import { analyzeServerAuditTemporalConsistency } from "./temporalConsistency";
import type { ServerAuditSnapshot } from "./types";

function baseSnapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-17T12:00:00.000Z",
    host: { hostname: "example-host" },
  };
}

test("accepts temporally consistent certificate and log evidence", () => {
  const snapshot = baseSnapshot();
  snapshot.web = {
    certificates: [{
      name: "example.test",
      notAfter: "2026-08-27T12:00:00.000Z",
      daysRemaining: 10,
    }],
  };
  snapshot.logs = [{ path: "/var/log/app.log", modifiedAt: "2026-08-17T11:59:00.000Z" }];

  const analysis = analyzeServerAuditTemporalConsistency(snapshot);
  assert.deepEqual(analysis.issues, []);
  assert.deepEqual(analysis.summary, {
    certificatesChecked: 1,
    logsChecked: 1,
    invalidTimestamps: 0,
    futureLogTimestamps: 0,
    certificateDayMismatches: 0,
  });
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);
});

test("reports invalid timestamps, future log time, and certificate day mismatch without exposing raw values", () => {
  const snapshot = baseSnapshot();
  snapshot.web = {
    certificates: [
      { name: "invalid.test", notAfter: "not-a-date", daysRemaining: 1 },
      { name: "mismatch.test", notAfter: "2026-08-27T12:00:00.000Z", daysRemaining: 2 },
    ],
  };
  snapshot.logs = [
    { path: "/secret/path.log", modifiedAt: "bad-log-time" },
    { path: "/another/secret.log", modifiedAt: "2026-08-17T12:10:01.000Z" },
  ];

  const analysis = analyzeServerAuditTemporalConsistency(snapshot, { maxFutureSkewMinutes: 10 });
  assert.deepEqual(
    analysis.issues.map((issue) => issue.kind),
    [
      "certificate-days-remaining-mismatch",
      "future-log-timestamp",
      "invalid-certificate-timestamp",
      "invalid-log-timestamp",
    ],
  );
  assert.deepEqual(analysis.summary, {
    certificatesChecked: 2,
    logsChecked: 2,
    invalidTimestamps: 2,
    futureLogTimestamps: 1,
    certificateDayMismatches: 1,
  });
  const serialized = JSON.stringify(analysis);
  assert.equal(serialized.includes("invalid.test"), false);
  assert.equal(serialized.includes("mismatch.test"), false);
  assert.equal(serialized.includes("/secret/path.log"), false);
  assert.equal(serialized.includes("/another/secret.log"), false);
});

test("bounds deterministic issue output and rejects invalid collection time or options", () => {
  const snapshot = baseSnapshot();
  snapshot.logs = [
    { path: "a", modifiedAt: "invalid-a" },
    { path: "b", modifiedAt: "invalid-b" },
  ];
  const analysis = analyzeServerAuditTemporalConsistency(snapshot, { maxIssues: 1 });
  assert.equal(analysis.issues.length, 1);
  assert.equal(analysis.execution.issuesTruncated, true);
  assert.equal(analysis.issues[0].source, "logs[0].modifiedAt");

  const invalidCollectedAt = baseSnapshot();
  invalidCollectedAt.collectedAt = "invalid";
  assert.throws(
    () => analyzeServerAuditTemporalConsistency(invalidCollectedAt),
    /valid snapshot collectedAt/,
  );
  assert.throws(
    () => analyzeServerAuditTemporalConsistency(baseSnapshot(), { maxIssues: 0 }),
    /maxIssues/,
  );
  assert.throws(
    () => analyzeServerAuditTemporalConsistency(baseSnapshot(), { maxCertificateDayDifference: 31 }),
    /maxCertificateDayDifference/,
  );
});

test("retains only the bounded deterministic temporal prefix for high-cardinality invalid evidence", () => {
  const snapshot = baseSnapshot();
  snapshot.logs = Array.from({ length: 5_000 }, (_, index) => ({
    path: `/private/logs/secret-${index}.log`,
    modifiedAt: "not-a-date",
  }));

  const analysis = analyzeServerAuditTemporalConsistency(snapshot, { maxIssues: 1_000 });

  assert.equal(analysis.issues.length, 1_000);
  assert.equal(analysis.execution.maxIssues, 1_000);
  assert.equal(analysis.execution.issuesTruncated, true);
  assert.equal(analysis.summary.logsChecked, 5_000);
  assert.equal(analysis.summary.invalidTimestamps, 5_000);
  assert.equal(analysis.issues[0].source, "logs[0].modifiedAt");
  assert.equal(new Set(analysis.issues.map((issue) => issue.id)).size, 1_000);

  const serialized = JSON.stringify(analysis);
  assert.equal(serialized.includes("/private/logs/"), false);
});
