import { createHash } from "node:crypto";

const JOB_ID = /^job_[a-f0-9]{32}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const REPORT_ID = /^report_[a-f0-9]{32}$/;
const PROVIDER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
export const MAX_PRIORITY_REPORT_BYTES = 32 * 1024;

function cleanJobId(value) {
  if (typeof value !== "string" || !JOB_ID.test(value)) {
    throw new Error("Priority report job ID is invalid.");
  }
  return value;
}

function cleanFingerprint(value) {
  if (typeof value !== "string" || !FINGERPRINT.test(value)) {
    throw new Error("Priority report source fingerprint is invalid.");
  }
  return value;
}

export function cleanCustomerPriorityReportText(value) {
  if (
    typeof value !== "string"
    || value.trim().length === 0
    || Buffer.byteLength(value, "utf8") > MAX_PRIORITY_REPORT_BYTES
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw new Error("Priority report text is invalid.");
  }
  return value;
}

function cleanProvider(value) {
  if (typeof value !== "string" || !PROVIDER.test(value)) {
    throw new Error("Priority report provider is invalid.");
  }
  return value;
}

export function customerPriorityReportId({ jobId, sourceFingerprint }) {
  const safeJobId = cleanJobId(jobId);
  const safeFingerprint = cleanFingerprint(sourceFingerprint);
  return `report_${createHash("sha256")
    .update(`${safeJobId}\u001f${safeFingerprint}`)
    .digest("hex")
    .slice(0, 32)}`;
}

export function createCustomerPriorityReport({ jobId, sourceFingerprint, provider, reportText }) {
  return {
    reportId: customerPriorityReportId({ jobId, sourceFingerprint }),
    provider: cleanProvider(provider),
    reportText: cleanCustomerPriorityReportText(reportText),
  };
}

export function validateCustomerPriorityReport(report, { jobId, sourceFingerprint }) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Priority report is invalid.");
  }
  const expectedReportId = customerPriorityReportId({ jobId, sourceFingerprint });
  if (typeof report.reportId !== "string" || !REPORT_ID.test(report.reportId) || report.reportId !== expectedReportId) {
    throw new Error("Priority report ID is invalid.");
  }
  return {
    reportId: report.reportId,
    provider: cleanProvider(report.provider),
    reportText: cleanCustomerPriorityReportText(report.reportText),
  };
}

export function publicCustomerPriorityReport(result) {
  if (result === undefined || result === null) return null;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  try {
    if (typeof result.reportId !== "string" || !REPORT_ID.test(result.reportId)) return null;
    return {
      reportId: result.reportId,
      provider: cleanProvider(result.provider),
      reportText: cleanCustomerPriorityReportText(result.reportText),
    };
  } catch {
    return null;
  }
}
