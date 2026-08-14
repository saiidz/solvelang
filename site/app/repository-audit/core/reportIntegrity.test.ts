import assert from "node:assert/strict";
import test from "node:test";
import {
  repositoryAuditIntegrityDigest,
  verifyRepositoryAuditIntegrity,
} from "./reportIntegrity";

test("verifies a digest that was computed before the integrity field existed", async () => {
  const report = {
    schemaVersion: "1.0.0",
    reportId: "ra_example",
    mode: "analyze-only",
  };
  const digest = await repositoryAuditIntegrityDigest(report);
  assert.equal(await verifyRepositoryAuditIntegrity({
    ...report,
    integrity: { canonicalJsonSha256: digest },
  }), true);
});

test("rejects a report changed after its digest was computed", async () => {
  const report = {
    schemaVersion: "1.0.0",
    reportId: "ra_example",
    mode: "analyze-only",
  };
  const digest = await repositoryAuditIntegrityDigest(report);
  assert.equal(await verifyRepositoryAuditIntegrity({
    ...report,
    mode: "changed",
    integrity: { canonicalJsonSha256: digest },
  }), false);
});
