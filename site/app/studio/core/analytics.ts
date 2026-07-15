import { analyzeWorkflow } from "./analysis";
import { buildGraphIndex, pathDepths } from "./graph";
import type { QualityScore, ScenarioRun, WorkflowAnalytics, WorkflowDocument } from "./types";

const percent = (value: number, total: number) => total ? Math.round((value / total) * 100) : 100;

function qualityScore(label: string, factors: Array<{ label: string; value: number; weight: number }>): QualityScore {
  const weight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const value = Math.round(factors.reduce((sum, factor) => sum + factor.value * factor.weight, 0) / Math.max(1, weight));
  return {
    value, formula: `${label} = weighted average of visible percentage factors`,
    factors: factors.map((factor) => ({ ...factor, deduction: Math.round(((100 - factor.value) * factor.weight) / Math.max(1, weight)), explanation: `${factor.label}: ${factor.value}% at weight ${factor.weight}.` })),
  };
}

export function calculateWorkflowAnalytics(workflow: WorkflowDocument, runs: ScenarioRun[]): WorkflowAnalytics {
  const index = buildGraphIndex(workflow);
  const analysis = analyzeWorkflow(workflow);
  const triggers = workflow.nodes.filter((node) => node.type === "trigger").map((node) => node.id);
  const depths = pathDepths(index, triggers);
  const handoffs = index.validEdges.filter((edge) => {
    const source = index.nodesById.get(edge.source)?.owner;
    const target = index.nodesById.get(edge.target)?.owner;
    return Boolean(source && target && source !== target);
  }).length;
  const exceptionNodes = workflow.nodes.filter((node) => node.type === "exception");
  const traversedNodes = runs.flatMap((run) => run.path);
  const traversedEdges = runs.flatMap((run) => run.branchesTaken);
  const nodeFrequency = new Map<string, number>();
  for (const id of traversedNodes) nodeFrequency.set(id, (nodeFrequency.get(id) ?? 0) + 1);
  const failures: Record<string, number> = {};
  for (const run of runs) for (const failure of run.failures) failures[failure] = (failures[failure] ?? 0) + 1;
  const passedRuns = runs.filter((run) => run.passed);
  const expectedTerminalMatches = runs.filter((run) => workflow.scenarios.find((scenario) => scenario.id === run.scenarioId)?.expectedTerminalState === run.terminalResult);
  const expectedReviews = workflow.scenarios.flatMap((scenario) => scenario.expectedHumanReviewPoints);
  const reachedReviews = new Set(runs.flatMap((run) => run.humanReviewPauses));
  const maxCycle = Math.max(0, ...runs.map((run) => run.elapsedSlaMinutes));
  const avgCycle = runs.length ? Math.round(runs.reduce((sum, run) => sum + run.elapsedSlaMinutes, 0) / runs.length) : 0;
  const exceptionCoverage = percent(exceptionNodes.filter((node) => (index.outgoing.get(node.id) ?? []).length > 0).length, exceptionNodes.length);
  const structural = {
    nodeCount: workflow.nodes.length, edgeCount: workflow.edges.length,
    decisionCount: workflow.nodes.filter((node) => node.type === "decision").length,
    exceptionPathCount: exceptionNodes.length, humanReviewCount: workflow.nodes.filter((node) => node.type === "human_review").length,
    approvalCount: workflow.nodes.filter((node) => node.type === "approval").length,
    systemCount: workflow.nodes.filter((node) => node.type === "system" || node.system).length,
    handoffCount: handoffs, averagePathDepth: Math.round(depths.reduce((sum, depth) => sum + depth, 0) / depths.length),
    maximumPathDepth: Math.max(...depths), branchCount: workflow.edges.filter((edge) => edge.condition || edge.fallback).length,
    policyCoverage: Math.round(analysis.coverage.policy * 100), ownerCoverage: Math.round(analysis.coverage.owner * 100),
    slaCoverage: Math.round(analysis.coverage.sla * 100), fallbackCoverage: Math.round(analysis.coverage.fallback * 100),
    exceptionCoverage,
  };
  const scenario = {
    scenarioPassRate: percent(passedRuns.length, runs.length), expectedTerminalMatchRate: percent(expectedTerminalMatches.length, runs.length),
    unresolvedDecisionRate: percent(runs.filter((run) => run.unresolvedDecisions.length > 0).length, runs.length),
    humanReviewCoverage: percent(expectedReviews.filter((id) => reachedReviews.has(id)).length, expectedReviews.length),
    averageModeledCycleTime: avgCycle, maximumModeledCycleTime: maxCycle,
    pathCoverage: percent(new Set(runs.map((run) => run.path.join("→"))).size, workflow.scenarios.length),
    nodeCoverage: percent(new Set(traversedNodes).size, workflow.nodes.length), edgeCoverage: percent(new Set(traversedEdges).size, workflow.edges.length),
    failureDistribution: failures,
    mostFrequentlyTraversedNodes: [...nodeFrequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id),
    neverTraversedNodes: workflow.nodes.filter((node) => !nodeFrequency.has(node.id)).map((node) => node.id),
  };
  return {
    structural, scenario,
    quality: {
      automationReadiness: analysis.score,
      explainability: qualityScore("Explainability", [{ label: "Owner coverage", value: structural.ownerCoverage, weight: 4 }, { label: "Fallback coverage", value: structural.fallbackCoverage, weight: 3 }, { label: "Node descriptions", value: percent(workflow.nodes.filter((node) => node.description.trim()).length, workflow.nodes.length), weight: 2 }]),
      resilience: qualityScore("Resilience", [{ label: "Exception coverage", value: structural.exceptionCoverage, weight: 4 }, { label: "Scenario pass rate", value: scenario.scenarioPassRate, weight: 4 }, { label: "Fallback coverage", value: structural.fallbackCoverage, weight: 2 }]),
      governance: qualityScore("Governance", [{ label: "Policy coverage", value: structural.policyCoverage, weight: 4 }, { label: "Human review coverage", value: scenario.humanReviewCoverage, weight: 3 }, { label: "Owner coverage", value: structural.ownerCoverage, weight: 3 }]),
      observability: qualityScore("Observability", [{ label: "SLA coverage", value: structural.slaCoverage, weight: 4 }, { label: "Node coverage", value: scenario.nodeCoverage, weight: 3 }, { label: "Output naming", value: percent(workflow.nodes.filter((node) => node.outputs.length).length, workflow.nodes.length), weight: 3 }]),
    },
  };
}
