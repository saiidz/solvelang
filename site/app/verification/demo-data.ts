// The public proof dataset for SolveLang Verification — every number
// on /verification/proof/ is computed from these records, and every
// record names its source. Two instruments, kept distinct:
//
//   1. liveRuns — the verification service's own check runs on the
//      public proof repository (saiidz/solvelang-verification-proof),
//      graded live by the deployed service. Ground truth (defective /
//      clean) was stated in each PR's body before grading. Counts and
//      durations are the check runs' own published summaries.
//   2. receiptAudits — public pull requests on other repositories,
//      graded from public data through the receipt path and audited
//      by hand (Nov 22 and Nov 24, 2026 prospect-receipt records).
//
// Claims discipline: nothing enters this file without a run record
// behind it. The pre-hotfix fixture runs (PRs #1–#5, Nov 26, 2026)
// are excluded — a service bug overwrote their final check states,
// so they no longer reflect the grading (see the methodology page).

export interface LiveRunRecord {
  pr: number;
  groundTruth: "defective" | "clean";
  mode: "enforce" | "report-only";
  /** The check run's conclusion, verbatim. */
  conclusion: "failure" | "success";
  blockingEvidence: boolean;
  verified: number;
  failed: number;
  unverified: number;
  durationSeconds: number;
  checkRunId: number;
  auditWritten: boolean;
  falseVerifiedLabel: boolean;
}

export const LIVE_RUNS: LiveRunRecord[] = [
  { pr: 8, groundTruth: "defective", mode: "enforce", conclusion: "failure", blockingEvidence: true, verified: 6, failed: 1, unverified: 1, durationSeconds: 18.5, checkRunId: 140122254893, auditWritten: true, falseVerifiedLabel: false },
  { pr: 9, groundTruth: "clean", mode: "enforce", conclusion: "success", blockingEvidence: false, verified: 6, failed: 1, unverified: 1, durationSeconds: 27.2, checkRunId: 140122269411, auditWritten: true, falseVerifiedLabel: false },
  { pr: 10, groundTruth: "clean", mode: "enforce", conclusion: "success", blockingEvidence: false, verified: 5, failed: 2, unverified: 1, durationSeconds: 27.0, checkRunId: 140122725544, auditWritten: true, falseVerifiedLabel: false },
  { pr: 11, groundTruth: "defective", mode: "report-only", conclusion: "success", blockingEvidence: true, verified: 6, failed: 1, unverified: 1, durationSeconds: 26.5, checkRunId: 140123083422, auditWritten: true, falseVerifiedLabel: false },
  { pr: 12, groundTruth: "clean", mode: "report-only", conclusion: "success", blockingEvidence: false, verified: 6, failed: 1, unverified: 1, durationSeconds: 22.2, checkRunId: 140127328466, auditWritten: true, falseVerifiedLabel: false },
  { pr: 13, groundTruth: "clean", mode: "report-only", conclusion: "success", blockingEvidence: false, verified: 4, failed: 2, unverified: 2, durationSeconds: 28.8, checkRunId: 140333214133, auditWritten: true, falseVerifiedLabel: false },
  { pr: 14, groundTruth: "defective", mode: "report-only", conclusion: "success", blockingEvidence: true, verified: 6, failed: 1, unverified: 1, durationSeconds: 16.5, checkRunId: 140887543810, auditWritten: true, falseVerifiedLabel: false },
  { pr: 15, groundTruth: "clean", mode: "report-only", conclusion: "success", blockingEvidence: false, verified: 5, failed: 2, unverified: 1, durationSeconds: 15.1, checkRunId: 140887551552, auditWritten: true, falseVerifiedLabel: false },
];

export interface ReceiptAuditRecord {
  repo: string;
  pr: number;
  auditedOn: string;
  /** Recorded catches, or null where the audit recorded graded findings instead. */
  catches: number | null;
  /** Findings the audit judged to be tool false positives. */
  toolFalsePositives: number | null;
  verified: number | null;
  failed: number | null;
  unverified: number;
  gradedItems: number;
  falseVerifiedLabel: boolean;
}

export const RECEIPT_AUDITS: ReceiptAuditRecord[] = [
  { repo: "meilisearch/meilisearch", pr: 5157, auditedOn: "November 22, 2026", catches: 7, toolFalsePositives: 2, verified: null, failed: null, unverified: 3, gradedItems: 12, falseVerifiedLabel: false },
  { repo: "statamic/cms", pr: 10439, auditedOn: "November 22, 2026", catches: 7, toolFalsePositives: 3, verified: null, failed: null, unverified: 5, gradedItems: 15, falseVerifiedLabel: false },
  { repo: "freshrss/freshrss", pr: 3053, auditedOn: "November 22, 2026", catches: 7, toolFalsePositives: 0, verified: null, failed: null, unverified: 2, gradedItems: 9, falseVerifiedLabel: false },
  { repo: "linkwarden/linkwarden", pr: 612, auditedOn: "November 22, 2026", catches: 7, toolFalsePositives: 0, verified: null, failed: null, unverified: 2, gradedItems: 9, falseVerifiedLabel: false },
  { repo: "espanso/espanso", pr: 2511, auditedOn: "November 24, 2026", catches: null, toolFalsePositives: null, verified: 5, failed: 1, unverified: 2, gradedItems: 8, falseVerifiedLabel: false },
];

export interface GradingTotals {
  prs: number;
  verified: number;
  failed: number;
  unverified: number;
  gradedItems: number;
  unverifiedShare: number;
}

export function liveTotals(): GradingTotals & {
  defectiveCaught: number;
  defectiveTotal: number;
  cleanFalseBlocks: number;
  cleanTotal: number;
  falseVerifiedLabels: number;
} {
  const verified = LIVE_RUNS.reduce((sum, run) => sum + run.verified, 0);
  const failed = LIVE_RUNS.reduce((sum, run) => sum + run.failed, 0);
  const unverified = LIVE_RUNS.reduce((sum, run) => sum + run.unverified, 0);
  const gradedItems = verified + failed + unverified;
  const defective = LIVE_RUNS.filter((run) => run.groundTruth === "defective");
  const clean = LIVE_RUNS.filter((run) => run.groundTruth === "clean");
  return {
    prs: LIVE_RUNS.length,
    verified,
    failed,
    unverified,
    gradedItems,
    unverifiedShare: gradedItems > 0 ? unverified / gradedItems : 0,
    defectiveCaught: defective.filter((run) => run.blockingEvidence).length,
    defectiveTotal: defective.length,
    cleanFalseBlocks: clean.filter((run) => run.blockingEvidence).length,
    cleanTotal: clean.length,
    falseVerifiedLabels: LIVE_RUNS.filter((run) => run.falseVerifiedLabel).length,
  };
}

export function receiptTotals(): {
  prs: number;
  catches: number;
  toolFalsePositives: number;
  unverified: number;
  gradedItems: number;
  unverifiedShare: number;
  falseVerifiedLabels: number;
} {
  const unverified = RECEIPT_AUDITS.reduce((sum, audit) => sum + audit.unverified, 0);
  const gradedItems = RECEIPT_AUDITS.reduce((sum, audit) => sum + audit.gradedItems, 0);
  return {
    prs: RECEIPT_AUDITS.length,
    catches: RECEIPT_AUDITS.reduce((sum, audit) => sum + (audit.catches ?? 0), 0),
    toolFalsePositives: RECEIPT_AUDITS.reduce(
      (sum, audit) => sum + (audit.toolFalsePositives ?? 0),
      0
    ),
    unverified,
    gradedItems,
    unverifiedShare: gradedItems > 0 ? unverified / gradedItems : 0,
    falseVerifiedLabels: RECEIPT_AUDITS.filter((audit) => audit.falseVerifiedLabel).length,
  };
}

export function combinedTotals(): GradingTotals & { falseVerifiedLabels: number } {
  const live = liveTotals();
  const receipts = receiptTotals();
  const unverified = live.unverified + receipts.unverified;
  const gradedItems = live.gradedItems + receipts.gradedItems;
  return {
    prs: live.prs + receipts.prs,
    verified: live.verified,
    failed: live.failed,
    unverified,
    gradedItems,
    unverifiedShare: gradedItems > 0 ? unverified / gradedItems : 0,
    falseVerifiedLabels: live.falseVerifiedLabels + receipts.falseVerifiedLabels,
  };
}

export function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}
