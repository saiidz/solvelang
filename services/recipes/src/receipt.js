// Graded run records + receipts for recipe executions — Stage 0.
//
// Every recipe execution, whatever its trigger and whatever its
// outcome (ran, skipped because not enabled, error), produces:
//   - a run record (the metering/audit-shaped fact of the firing), and
//   - a graded receipt (findings labeled verified / failed /
//     unverified, in the verification service's grading discipline).
//
// Grading discipline (non-negotiable, mirroring the Change Impact
// Receipt):
//   - a finding may be labeled "verified" ONLY when it carries
//     evidence (evidence: true — the executor actually observed the
//     fact). A verified label without evidence is reclassified to
//     "unverified" before counting; it is never counted as verified.
//   - receipt.falseVerifiedLabel is therefore always false, and the
//     QA pins assert that invariant on adversarial input.
//   - metering is cost VISIBILITY only: duration and executor inputs
//     are recorded; a receipt never carries pricing, charge, or
//     Stripe fields.

export const RUN_CONCLUSIONS = Object.freeze(["success", "failure", "skipped", "error"]);
export const FINDING_LABELS = Object.freeze(["verified", "failed", "unverified"]);

export function gradeFindings(findings) {
  const graded = [];
  for (const finding of findings ?? []) {
    if (!finding || typeof finding.text !== "string" || finding.text === "") continue;
    let label = FINDING_LABELS.includes(finding.label) ? finding.label : "unverified";
    if (label === "verified" && finding.evidence !== true) {
      // A claim of verification without observed evidence is not a
      // verified finding. Downgrade — never count it, never label it.
      label = "unverified";
    }
    graded.push({ label, text: finding.text });
  }
  const grading = { verified: 0, failed: 0, unverified: 0 };
  for (const finding of graded) grading[finding.label] += 1;
  return { findings: graded, grading };
}

// Builds the run record + receipt for one execution. `notes` are
// visible, human-readable lines (e.g. the invalid-config note) that
// ride in BOTH the record and the receipt — never silent.
export function buildRunRecord({
  id,
  repo,
  recipeId,
  trigger,
  conclusion,
  findings,
  notes = [],
  baseSha = null,
  headSha = null,
  prNumber = null,
  installationId = null,
  startedAt,
  finishedAt,
  executor = null,
}) {
  if (!RUN_CONCLUSIONS.includes(conclusion)) throw new Error("run_conclusion_invalid");
  const { findings: gradedFindings, grading } = gradeFindings(findings);
  const durationMs = Math.max(0, (finishedAt ?? 0) - (startedAt ?? 0));
  const record = {
    id,
    kind: "recipe_run",
    repo,
    recipeId,
    trigger,
    conclusion,
    baseSha,
    headSha,
    prNumber,
    installationId,
    startedAt: startedAt ?? null,
    finishedAt: finishedAt ?? null,
    // Metering — cost visibility only. No price, no charge.
    metering: { durationMs, executor },
    grading,
    notes: [...notes],
    auditOk: false,
  };
  const receipt = {
    kind: "recipe_receipt",
    runId: id,
    repo,
    recipeId,
    trigger,
    conclusion,
    grading,
    // Invariant: no finding in this receipt carries a verified label
    // it did not earn with evidence (see gradeFindings).
    falseVerifiedLabel: false,
    findings: gradedFindings,
    notes: [...notes],
    metering: { durationMs, executor },
  };
  return { record, receipt };
}

// One-line human summary of a receipt, for logs and account surfaces.
export function summarizeReceipt(receipt) {
  const { verified, failed, unverified } = receipt.grading;
  return (
    `${receipt.recipeId} on ${receipt.repo}: ${receipt.conclusion} — ` +
    `${verified} verified · ${failed} failed · ${unverified} unverified ` +
    `(falseVerifiedLabel: false), ${(receipt.metering.durationMs / 1000).toFixed(1)}s.`
  );
}
