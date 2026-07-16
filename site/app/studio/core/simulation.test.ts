import test from "node:test";
import assert from "node:assert/strict";
import { compareScenarioRuns } from "./comparison";
import { simulateScenario } from "./simulation";
import { validSupportTriageFixture } from "./fixtures";
import type { WorkflowNode } from "./types";

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

function linearWorkflow(size: number) {
  const workflow = validSupportTriageFixture();
  workflow.nodes = Array.from({ length: size }, (_, index): WorkflowNode => ({ ...structuredClone(workflow.nodes[0]), id: `linear-${index}`, title: `Step ${index}`, type: index === 0 ? "trigger" : index === size - 1 ? "terminal" : "action", outputs: index === size - 1 ? ["done"] : [], metadata: index === size - 1 ? {} : { errorPath: "modeled" } }));
  workflow.edges = Array.from({ length: size - 1 }, (_, index) => ({ id: `linear-edge-${index}`, source: `linear-${index}`, target: `linear-${index + 1}`, condition: "", priority: 1, label: "next", fallback: false, metadata: {} }));
  workflow.scenarios = [{ id: "linear-scenario", name: "Linear", description: "", startingTrigger: "linear-0", inputVariables: {}, decisionOutcomes: {}, expectedTerminalState: `linear-${size - 1}`, expectedHumanReviewPoints: [], expectedOutputs: ["done"] }];
  workflow.policies = [];
  return workflow;
}

test("a terminal reached on step 200 passes while longer paths stop safely", () => {
  const exact = linearWorkflow(200);
  const exactRun = simulateScenario(exact, exact.scenarios[0]);
  assert.equal(exactRun.passed, true);
  assert.equal(exactRun.path.length, 200);

  const longer = linearWorkflow(201);
  const longerRun = simulateScenario(longer, longer.scenarios[0]);
  assert.equal(longerRun.passed, false);
  assert.match(longerRun.failures.join(" "), /200-step safety limit/);
});
