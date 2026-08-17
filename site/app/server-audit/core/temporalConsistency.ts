import type { ServerAuditSnapshot } from "./types";

export type ServerAuditTemporalIssueKind =
  | "invalid-certificate-timestamp"
  | "certificate-days-remaining-mismatch"
  | "invalid-log-timestamp"
  | "future-log-timestamp";

export type ServerAuditTemporalIssue = {
  id: string;
  kind: ServerAuditTemporalIssueKind;
  severity: "low" | "info";
  source: string;
  summary: string;
};

export type ServerAuditTemporalConsistencyOptions = {
  maxIssues?: number;
  maxFutureSkewMinutes?: number;
  maxCertificateDayDifference?: number;
};

export type ServerAuditTemporalConsistencyAnalysis = {
  schema: "solvelang.server-audit.temporal-consistency.v0";
  mode: "analyze-only";
  snapshotCollectedAt: string;
  issues: ServerAuditTemporalIssue[];
  summary: {
    certificatesChecked: number;
    logsChecked: number;
    invalidTimestamps: number;
    futureLogTimestamps: number;
    certificateDayMismatches: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxIssues: number;
    maxFutureSkewMinutes: number;
    maxCertificateDayDifference: number;
    issuesTruncated: boolean;
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function boundedNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function timestamp(value: string | undefined): number | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function issueId(kind: ServerAuditTemporalIssueKind, source: string): string {
  return `server-temporal:${kind}:${source}`;
}

function compareText(left: ServerAuditTemporalIssue, right: ServerAuditTemporalIssue): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function analyzeServerAuditTemporalConsistency(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditTemporalConsistencyOptions = {},
): ServerAuditTemporalConsistencyAnalysis {
  const maxIssues = boundedInteger(options.maxIssues, 500, 1, 5_000, "Server Audit temporal maxIssues");
  const maxFutureSkewMinutes = boundedNumber(
    options.maxFutureSkewMinutes,
    5,
    0,
    24 * 60,
    "Server Audit temporal maxFutureSkewMinutes",
  );
  const maxCertificateDayDifference = boundedNumber(
    options.maxCertificateDayDifference,
    2,
    0,
    30,
    "Server Audit temporal maxCertificateDayDifference",
  );

  const collectedAtMs = timestamp(snapshot.collectedAt);
  if (collectedAtMs === undefined) {
    throw new Error("Server Audit temporal analysis requires a valid snapshot collectedAt timestamp.");
  }

  const issues: ServerAuditTemporalIssue[] = [];
  let certificatesChecked = 0;
  let logsChecked = 0;
  let invalidTimestamps = 0;
  let futureLogTimestamps = 0;
  let certificateDayMismatches = 0;

  for (let index = 0; index < (snapshot.web?.certificates?.length ?? 0); index += 1) {
    const certificate = snapshot.web!.certificates![index];
    if (certificate.notAfter === undefined) continue;
    certificatesChecked += 1;
    const source = `web.certificates[${index}].notAfter`;
    const notAfterMs = timestamp(certificate.notAfter);
    if (notAfterMs === undefined) {
      invalidTimestamps += 1;
      issues.push({
        id: issueId("invalid-certificate-timestamp", source),
        kind: "invalid-certificate-timestamp",
        severity: "low",
        source,
        summary: "Certificate expiry timestamp is not parseable; expiry posture cannot be trusted for this entry.",
      });
      continue;
    }

    if (certificate.daysRemaining !== undefined) {
      const expectedDays = (notAfterMs - collectedAtMs) / DAY_MS;
      if (Math.abs(expectedDays - certificate.daysRemaining) > maxCertificateDayDifference) {
        certificateDayMismatches += 1;
        issues.push({
          id: issueId("certificate-days-remaining-mismatch", `web.certificates[${index}]`),
          kind: "certificate-days-remaining-mismatch",
          severity: "info",
          source: `web.certificates[${index}]`,
          summary: "Certificate daysRemaining materially disagrees with notAfter relative to snapshot collection time.",
        });
      }
    }
  }

  const futureCutoff = collectedAtMs + maxFutureSkewMinutes * MINUTE_MS;
  for (let index = 0; index < (snapshot.logs?.length ?? 0); index += 1) {
    const log = snapshot.logs![index];
    if (log.modifiedAt === undefined) continue;
    logsChecked += 1;
    const source = `logs[${index}].modifiedAt`;
    const modifiedAtMs = timestamp(log.modifiedAt);
    if (modifiedAtMs === undefined) {
      invalidTimestamps += 1;
      issues.push({
        id: issueId("invalid-log-timestamp", source),
        kind: "invalid-log-timestamp",
        severity: "low",
        source,
        summary: "Log modification timestamp is not parseable; recency posture cannot be trusted for this entry.",
      });
      continue;
    }
    if (modifiedAtMs > futureCutoff) {
      futureLogTimestamps += 1;
      issues.push({
        id: issueId("future-log-timestamp", source),
        kind: "future-log-timestamp",
        severity: "info",
        source,
        summary: "Log modification timestamp is later than snapshot collection time beyond the allowed clock-skew window.",
      });
    }
  }

  issues.sort(compareText);
  const boundedIssues = issues.slice(0, maxIssues);

  return {
    schema: "solvelang.server-audit.temporal-consistency.v0",
    mode: "analyze-only",
    snapshotCollectedAt: new Date(collectedAtMs).toISOString(),
    issues: boundedIssues,
    summary: {
      certificatesChecked,
      logsChecked,
      invalidTimestamps,
      futureLogTimestamps,
      certificateDayMismatches,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxIssues,
      maxFutureSkewMinutes,
      maxCertificateDayDifference,
      issuesTruncated: issues.length > maxIssues,
    },
  };
}
