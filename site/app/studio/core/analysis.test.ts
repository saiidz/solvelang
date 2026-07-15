import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWorkflow, calculateReadinessScore } from "./analysis";
import { fixtureForRule, validSupportTriageFixture } from "./fixtures";

const ruleIds = Array.from({ length: 25 }, (_, index) => `SL${String(index + 1).padStart(3, "0")}`);

for (const ruleId of ruleIds) {
  test(`${ruleId} reports its focused fixture`, () => {
    const analysis = analyzeWorkflow(fixtureForRule(ruleId));
    assert.ok(analysis.findings.some((finding) => finding.ruleId === ruleId), `${ruleId} was not reported`);
  });
}

test("valid workflow returns passed checks and an explainable score", () => {
  const analysis = analyzeWorkflow(validSupportTriageFixture());
  assert.ok(analysis.passedChecks.length > 0);
  assert.ok(analysis.score.value >= 70);
  assert.equal(analysis.score.factors.reduce((sum, factor) => sum + factor.deduction, 0), 100 - analysis.score.value);
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
