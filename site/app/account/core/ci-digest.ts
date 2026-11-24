// Weekly CI health digest (Service 4, Nov 24, 2026) — the account
// page's contract with the Runner Minutes service, in the same
// pure-shaping style as the other account core modules: no fetch, no
// window, so the QA suite can pin the shapes directly.
//
// The service answers GET /customer/runner-minutes/ci-digest (same
// session-cookie pattern as the runner-minutes account read) with:
//   { digests: [ {
//       id, kind: "weekly-ci-digest", tenantId, repo,
//       windowStart, windowEnd, generatedAt,
//       insufficientData, note,
//       totals: { recordsInWindow, jobsServed, concludedJobs,
//                 successes, failures, cancellations,
//                 successRatePercent, totalBilledSeconds,
//                 totalMinutes, wastedSeconds, wastedMinutes },
//       slowestRuns: [{ runId, jobs, minutes, billedSeconds, failures, firstAt }],
//       slowestJobs: [{ jobId, runId, minutes, billedSeconds, outcome, lane, at }],
//       mixedOutcomeRuns: [{ runId, jobs, successes, failures, minutes, firstAt }],
//   } ] }
// newest first. Every figure in a digest is a count or a sum over the
// serve records the service already stores — the page renders the
// service's numbers verbatim and never computes its own. A service
// without the digest surface (404/503/any error) or a malformed
// payload normalizes to an empty list, and the page renders its
// "no digest yet" state rather than inventing numbers.

export const CI_DIGEST_PATH = "/customer/runner-minutes/ci-digest";

export const CI_DIGEST_EYEBROW = "Runner Minutes";
export const CI_DIGEST_TITLE = "Weekly CI health digest";
export const CI_DIGEST_INTRO =
  "Once a week, this digest is built from the runner jobs actually served for your repositories — the same records your minutes are billed from. Nothing here is estimated: every figure counts or sums those stored records for the week shown.";
export const CI_DIGEST_DELIVERY_LINE =
  "Your digest lives here in your account. It is not sent by email.";
export const CI_DIGEST_EMPTY_LINE =
  "No digest yet. Your first weekly digest appears here after the weekly run, once runner jobs have been served for a connected repository.";
export const CI_DIGEST_WASTED_LABEL = "Minutes billed to failed or cancelled jobs";
export const CI_DIGEST_MIXED_HEADING = "Runs with both passing and failing jobs";
export const CI_DIGEST_MIXED_LINE =
  "These workflow runs contained both successful and failed jobs in the same run, from the stored records.";

export type CiDigestTotals = {
  recordsInWindow: number;
  jobsServed: number;
  concludedJobs: number;
  successes: number;
  failures: number;
  cancellations: number;
  successRatePercent: number | null;
  totalMinutes: number;
  wastedMinutes: number;
};

export type CiDigestSlowestRun = {
  runId: string | number;
  jobs: number;
  minutes: number;
  failures: number;
};

export type CiDigestSlowestJob = {
  jobId: string | number;
  runId: string | number | null;
  minutes: number;
  outcome: string;
  at: string;
};

export type CiDigestMixedRun = {
  runId: string | number;
  jobs: number;
  successes: number;
  failures: number;
  minutes: number;
};

export type CiDigest = {
  id: string;
  repo: string;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  insufficientData: boolean;
  note: string | null;
  totals: CiDigestTotals;
  slowestRuns: CiDigestSlowestRun[];
  slowestJobs: CiDigestSlowestJob[];
  mixedOutcomeRuns: CiDigestMixedRun[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function idOr(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function parseTotals(value: unknown): CiDigestTotals {
  const totals = isRecord(value) ? value : {};
  return {
    recordsInWindow: numberOr(totals.recordsInWindow, 0),
    jobsServed: numberOr(totals.jobsServed, 0),
    concludedJobs: numberOr(totals.concludedJobs, 0),
    successes: numberOr(totals.successes, 0),
    failures: numberOr(totals.failures, 0),
    cancellations: numberOr(totals.cancellations, 0),
    successRatePercent:
      typeof totals.successRatePercent === "number" && Number.isFinite(totals.successRatePercent)
        ? totals.successRatePercent
        : null,
    totalMinutes: numberOr(totals.totalMinutes, 0),
    wastedMinutes: numberOr(totals.wastedMinutes, 0),
  };
}

function parseDigest(value: unknown): CiDigest | null {
  if (!isRecord(value)) return null;
  if (typeof value.repo !== "string" || value.repo === "") return null;
  const slowestRuns: CiDigestSlowestRun[] = [];
  if (Array.isArray(value.slowestRuns)) {
    for (const run of value.slowestRuns) {
      if (!isRecord(run)) continue;
      const runId = idOr(run.runId);
      if (runId === null) continue;
      slowestRuns.push({
        runId,
        jobs: numberOr(run.jobs, 0),
        minutes: numberOr(run.minutes, 0),
        failures: numberOr(run.failures, 0),
      });
    }
  }
  const slowestJobs: CiDigestSlowestJob[] = [];
  if (Array.isArray(value.slowestJobs)) {
    for (const job of value.slowestJobs) {
      if (!isRecord(job)) continue;
      const jobId = idOr(job.jobId);
      if (jobId === null) continue;
      slowestJobs.push({
        jobId,
        runId: idOr(job.runId),
        minutes: numberOr(job.minutes, 0),
        outcome: stringOr(job.outcome, "finished"),
        at: stringOr(job.at, ""),
      });
    }
  }
  const mixedOutcomeRuns: CiDigestMixedRun[] = [];
  if (Array.isArray(value.mixedOutcomeRuns)) {
    for (const run of value.mixedOutcomeRuns) {
      if (!isRecord(run)) continue;
      const runId = idOr(run.runId);
      if (runId === null) continue;
      mixedOutcomeRuns.push({
        runId,
        jobs: numberOr(run.jobs, 0),
        successes: numberOr(run.successes, 0),
        failures: numberOr(run.failures, 0),
        minutes: numberOr(run.minutes, 0),
      });
    }
  }
  return {
    id: stringOr(value.id, ""),
    repo: value.repo,
    windowStart: stringOr(value.windowStart, ""),
    windowEnd: stringOr(value.windowEnd, ""),
    generatedAt: stringOr(value.generatedAt, ""),
    insufficientData: value.insufficientData === true,
    note: typeof value.note === "string" ? value.note : null,
    totals: parseTotals(value.totals),
    slowestRuns,
    slowestJobs,
    mixedOutcomeRuns,
  };
}

// Normalize whatever the service answered into the digest list the
// page renders. Anything unrecognized becomes an empty list — the
// page's empty state — never a partially invented digest.
export function parseCiDigests(payload: unknown): CiDigest[] {
  if (!isRecord(payload) || !Array.isArray(payload.digests)) return [];
  const digests: CiDigest[] = [];
  for (const entry of payload.digests) {
    const digest = parseDigest(entry);
    if (digest) digests.push(digest);
  }
  return digests;
}

// The page shows the latest digest per repository. The service
// answers newest first, so the first digest seen for a repo is its
// latest; the rest are earlier weeks and are not rendered.
export function latestDigestPerRepo(digests: CiDigest[]): CiDigest[] {
  const seen = new Set<string>();
  const latest: CiDigest[] = [];
  for (const digest of digests) {
    if (seen.has(digest.repo)) continue;
    seen.add(digest.repo);
    latest.push(digest);
  }
  return latest;
}

export function formatDigestWindow(digest: CiDigest): string {
  const start = digest.windowStart.slice(0, 10);
  const end = digest.windowEnd.slice(0, 10);
  if (!start || !end) return "";
  return `Week of ${start} to ${end}`;
}

export function formatMinutes(minutes: number): string {
  return `${minutes.toFixed(2)} min`;
}
