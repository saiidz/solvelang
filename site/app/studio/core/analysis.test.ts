import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWorkflow, calculateReadinessScore } from "./analysis";
import { fixtureForRule, validSupportTriageFixture } from "./fixtures";

const ruleIds = Array.from({ length: 25 }, (_, index) => `SL${String(index + 1).padStart(3, "0")}`);
const expectedSeverities = [
  "error", "warning", "error", "error", "warning", "warning", "warning", "error", "error", "error",
  "error", "warning", "warning", "warning", "warning", "recommendation", "recommendation", "error", "error", "warning",
  "warning", "error", "error", "warning", "recommendation",
] as const;

for (const ruleId of ruleIds) {
  test(`${ruleId} reports its focused fixture`, () => {
    const analysis = analyzeWorkflow(fixtureForRule(ruleId));
    const matches = analysis.findings.filter((finding) => finding.ruleId === ruleId);
    assert.ok(matches.length > 0, `${ruleId} was not reported`);
    for (const finding of matches) {
      assert.equal(finding.severity, expectedSeverities[Number(ruleId.slice(2)) - 1]);
      assert.ok(finding.explanation.length > 10);
      assert.ok(finding.remediation.length > 10);
      assert.ok(finding.evidence.length > 0);
      assert.equal(finding.suppressible, finding.severity !== "error");
    }
    assert.equal(analyzeWorkflow(validSupportTriageFixture()).findings.some((finding) => finding.ruleId === ruleId), false, `${ruleId} remained after correction`);
  });
}

test("valid workflow returns passed checks and an explainable score", () => {
  const analysis = analyzeWorkflow(validSupportTriageFixture());
  assert.equal(analysis.findings.length, 0);
  assert.equal(analysis.passedChecks.length, 25);
  assert.equal(analysis.score.value, 100);
  assert.equal(analysis.score.factors.reduce((sum, factor) => sum + factor.deduction, 0), 100 - analysis.score.value);
});

test("finding order and identifiers are deterministic without duplicates", () => {
  const workflow = fixtureForRule("SL022");
  const first = analyzeWorkflow(workflow);
  const second = analyzeWorkflow(structuredClone(workflow));
  assert.deepEqual(second, first);
  assert.equal(new Set(first.findings.map((finding) => finding.id)).size, first.findings.length);
});

test("errors cannot be suppressed while warning suppression is scoped and stable", () => {
  const errorWorkflow = fixtureForRule("SL001");
  errorWorkflow.suppressedRuleIds = ["SL001"];
  const error = analyzeWorkflow(errorWorkflow).findings.find((finding) => finding.ruleId === "SL001")!;
  assert.equal(error.suppressed, false);

  const warningWorkflow = fixtureForRule("SL006");
  warningWorkflow.suppressedRuleIds = ["SL006"];
  const analysis = analyzeWorkflow(warningWorkflow);
  assert.equal(analysis.findings.find((finding) => finding.ruleId === "SL006")?.suppressed, true);
  assert.ok(analysis.findings.filter((finding) => finding.ruleId !== "SL006").every((finding) => !finding.suppressed));
});

test("readiness score applies severity and coverage deductions deterministically", () => {
  const result = calculateReadinessScore(
    [
      { severity: "error", suppressed: false },
      { severity: "warning", suppressed: false },
      { severity: "recommendation", suppressed: true },
    ],
    { owner: 0.5, sla: 1, fallback: 0, policy: 1, terminal: 1 },
  );
  assert.equal(result.value, 65);
  assert.ok(result.factors.some((factor) => factor.label === "Error findings" && factor.deduction === 12));
});
