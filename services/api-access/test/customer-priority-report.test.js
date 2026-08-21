import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PRIORITY_REPORT_BYTES,
  cleanCustomerPriorityReportText,
  createCustomerPriorityReport,
  customerPriorityReportId,
  publicCustomerPriorityReport,
  validateCustomerPriorityReport,
} from "../src/customer-priority-report.js";

const JOB_ID = `job_${"a".repeat(32)}`;
const FINGERPRINT = "b".repeat(64);

function report(overrides = {}) {
  return createCustomerPriorityReport({
    jobId: JOB_ID,
    sourceFingerprint: FINGERPRINT,
    provider: "fixture-provider",
    reportText: "Audit summary\n- No critical findings.",
    ...overrides,
  });
}

test("report identity is deterministic and owned by SolveLang job/source identity", () => {
  const first = customerPriorityReportId({ jobId: JOB_ID, sourceFingerprint: FINGERPRINT });
  const second = customerPriorityReportId({ jobId: JOB_ID, sourceFingerprint: FINGERPRINT });
  assert.equal(first, second);
  assert.match(first, /^report_[a-f0-9]{32}$/);
  assert.notEqual(
    first,
    customerPriorityReportId({ jobId: `job_${"c".repeat(32)}`, sourceFingerprint: FINGERPRINT }),
  );
});

test("report text accepts plain text/newlines but rejects control bytes and oversized output", () => {
  assert.equal(cleanCustomerPriorityReportText("line one\nline two\tvalue"), "line one\nline two\tvalue");
  assert.throws(() => cleanCustomerPriorityReportText(""), /report text is invalid/);
  assert.throws(() => cleanCustomerPriorityReportText("bad\u0000text"), /report text is invalid/);
  assert.throws(() => cleanCustomerPriorityReportText("x".repeat(MAX_PRIORITY_REPORT_BYTES + 1)), /report text is invalid/);
});

test("worker validation rejects a mismatched report ID or malformed provider", () => {
  const good = report();
  assert.deepEqual(validateCustomerPriorityReport(good, { jobId: JOB_ID, sourceFingerprint: FINGERPRINT }), good);
  assert.throws(
    () => validateCustomerPriorityReport({ ...good, reportId: `report_${"f".repeat(32)}` }, { jobId: JOB_ID, sourceFingerprint: FINGERPRINT }),
    /report ID is invalid/,
  );
  assert.throws(
    () => createCustomerPriorityReport({
      jobId: JOB_ID,
      sourceFingerprint: FINGERPRINT,
      provider: "provider with spaces",
      reportText: "report",
    }),
    /provider is invalid/,
  );
});

test("public report exposes only customer-safe report fields and fails closed on malformed stored data", () => {
  const good = report();
  assert.deepEqual(publicCustomerPriorityReport({
    ...good,
    processedBy: "internal-worker-id",
    sourceFingerprint: FINGERPRINT,
    secret: "must-not-escape",
  }), good);
  assert.equal(publicCustomerPriorityReport({ ...good, reportText: "bad\u0000text" }), null);
  assert.equal(publicCustomerPriorityReport({ reportId: good.reportId }), null);
});
