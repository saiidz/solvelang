import assert from "node:assert/strict";
import test from "node:test";

import { buildRunRecord, gradeFindings, summarizeReceipt } from "../src/receipt.js";

// QA pins for graded recipe receipts: the verified/failed/unverified
// discipline, the falseVerifiedLabel invariant on adversarial input,
// and metering as cost-visibility only (no pricing fields anywhere).

test("findings with evidence keep their labels and are counted", () => {
  const { findings, grading } = gradeFindings([
    { label: "verified", text: "Config file present at base SHA.", evidence: true },
    { label: "failed", text: "Executor exited non-zero.", evidence: true },
    { label: "unverified", text: "Coverage not established." },
  ]);
  assert.deepEqual(grading, { verified: 1, failed: 1, unverified: 1 });
  assert.deepEqual(
    findings.map((finding) => finding.label),
    ["verified", "failed", "unverified"]
  );
});

test("a verified label without evidence is downgraded to unverified, never counted", () => {
  const { findings, grading } = gradeFindings([
    { label: "verified", text: "Trust me." },
    { label: "verified", text: "Evidence flag is a string.", evidence: "yes" },
    { label: "verified", text: "Real evidence.", evidence: true },
  ]);
  assert.deepEqual(grading, { verified: 1, failed: 0, unverified: 2 });
  assert.equal(findings[0].label, "unverified");
  assert.equal(findings[1].label, "unverified");
});

test("unknown labels and empty findings degrade to unverified / are dropped", () => {
  const { findings, grading } = gradeFindings([
    { label: "proven", text: "Not a real label." },
    { label: "verified", text: "" },
    null,
    { text: "No label at all." },
  ]);
  assert.deepEqual(grading, { verified: 0, failed: 0, unverified: 2 });
  assert.equal(findings.length, 2);
});

test("run record + receipt carry grading, notes and metering — and no pricing fields", () => {
  const { record, receipt } = buildRunRecord({
    id: "run-1",
    repo: "octo/widgets",
    recipeId: "lint-autofix",
    trigger: "schedule",
    conclusion: "success",
    findings: [{ label: "verified", text: "Ran.", evidence: true }],
    notes: ["a visible note"],
    baseSha: "a".repeat(40),
    startedAt: 1_000,
    finishedAt: 3_500,
    executor: "process-solution-app",
  });
  assert.equal(record.metering.durationMs, 2_500);
  assert.equal(record.auditOk, false);
  assert.deepEqual(record.notes, ["a visible note"]);
  assert.equal(receipt.falseVerifiedLabel, false);
  assert.deepEqual(receipt.grading, { verified: 1, failed: 0, unverified: 0 });
  const serialized = JSON.stringify({ record, receipt }).toLowerCase();
  for (const banned of ["price", "charge", "stripe", "amount", "currency"]) {
    assert.ok(!serialized.includes(banned), banned);
  }
  assert.match(summarizeReceipt(receipt), /falseVerifiedLabel: false/);
});

test("invalid conclusions are rejected", () => {
  assert.throws(
    () =>
      buildRunRecord({
        id: "run-x",
        repo: "octo/widgets",
        recipeId: "lint-autofix",
        trigger: "manual",
        conclusion: "done",
        findings: [],
        startedAt: 0,
        finishedAt: 0,
      }),
    /run_conclusion_invalid/
  );
});
