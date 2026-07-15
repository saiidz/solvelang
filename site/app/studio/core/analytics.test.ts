import test from "node:test";
import assert from "node:assert/strict";
import { calculateWorkflowAnalytics } from "./analytics";
import { simulateScenario } from "./simulation";
import { validSupportTriageFixture } from "./fixtures";

test("analytics compute required structural, scenario, and quality metrics", () => {
  const workflow = validSupportTriageFixture();
  const runs = workflow.scenarios.map((scenario) => simulateScenario(workflow, scenario));
  const analytics = calculateWorkflowAnalytics(workflow, runs);
  assert.equal(analytics.structural.nodeCount, workflow.nodes.length);
  assert.equal(analytics.structural.edgeCount, workflow.edges.length);
  assert.ok(analytics.structural.decisionCount >= 1);
  assert.ok(analytics.structural.handoffCount >= 1);
  assert.ok(analytics.structural.maximumPathDepth >= analytics.structural.averagePathDepth);
  assert.equal(typeof analytics.scenario.scenarioPassRate, "number");
  assert.ok(analytics.scenario.nodeCoverage > 0);
  assert.deepEqual(Object.keys(analytics.quality).sort(), ["automationReadiness", "explainability", "governance", "observability", "resilience"].sort());
  for (const score of Object.values(analytics.quality)) {
    assert.equal(Number.isInteger(score.value), true);
    assert.ok(score.factors.length > 0);
  }
});

test("no-run analytics are bounded and do not claim scenario success", () => {
  const workflow = validSupportTriageFixture();
  const analytics = calculateWorkflowAnalytics(workflow, []);
  assert.equal(analytics.scenario.scenarioPassRate, 0);
  assert.equal(analytics.scenario.unresolvedDecisionRate, 0);
  assert.equal(analytics.scenario.pathCoverage, 0);
  assert.equal(analytics.scenario.nodeCoverage, 0);
  assert.equal(analytics.scenario.edgeCoverage, 0);
});

test("terminal match rate excludes scenarios without an expected terminal", () => {
  const workflow = validSupportTriageFixture();
  const expected = simulateScenario(workflow, workflow.scenarios[0]);
  const noExpectation = { ...simulateScenario(workflow, workflow.scenarios[1]), terminalResult: null };
  const analytics = calculateWorkflowAnalytics(workflow, [expected, noExpectation]);
  assert.equal(analytics.scenario.expectedTerminalMatchRate, 100);
});
