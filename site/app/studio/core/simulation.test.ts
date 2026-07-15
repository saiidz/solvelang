import test from "node:test";
import assert from "node:assert/strict";
import { compareScenarioRuns } from "./comparison";
import { simulateScenario } from "./simulation";
import { validSupportTriageFixture } from "./fixtures";

test("simulation produces a deterministic trace and expected terminal", () => {
  const workflow = validSupportTriageFixture();
  const scenario = workflow.scenarios.find((item) => item.name === "Happy path")!;
  const result = simulateScenario(workflow, scenario);
  assert.equal(result.passed, true);
  assert.equal(result.terminalResult, scenario.expectedTerminalState);
  assert.deepEqual(result.trace.map((event) => event.sequence), result.trace.map((_, index) => index + 1));
  assert.ok(result.branchesTaken.length > 0);
});

test("missing decision outcome pauses as unresolved instead of guessing", () => {
  const workflow = validSupportTriageFixture();
  const scenario = { ...workflow.scenarios[0], id: "scenario-unresolved", decisionOutcomes: {} };
  const result = simulateScenario(workflow, scenario);
  assert.equal(result.passed, false);
  assert.ok(result.unresolvedDecisions.length > 0);
});

test("urgent path records human-review and policy checks", () => {
  const workflow = validSupportTriageFixture();
  const scenario = workflow.scenarios.find((item) => item.name === "Urgent high-risk")!;
  const result = simulateScenario(workflow, scenario);
  assert.ok(result.humanReviewPauses.length > 0);
  assert.ok(result.policyChecks.some((check) => check.result === "passed"));
});

test("scenario comparison explains path, review, SLA, risk, and terminal changes", () => {
  const workflow = validSupportTriageFixture();
  const baseline = simulateScenario(workflow, workflow.scenarios[0]);
  const urgent = simulateScenario(workflow, workflow.scenarios[2]);
  const comparison = compareScenarioRuns(workflow, baseline, urgent);
  assert.ok(comparison.path.added.length + comparison.path.removed.length > 0);
  assert.ok(comparison.humanReview.added.length > 0);
  assert.notEqual(comparison.sla.before, comparison.sla.after);
  assert.ok(comparison.risk.changed);
});
