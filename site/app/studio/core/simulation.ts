import { buildGraphIndex } from "./graph";
import type { PolicyCheck, ScenarioRun, TraceEvent, WorkflowDocument, WorkflowScenario } from "./types";

function summarize(values: string[]) { return values.length ? values.join(", ") : "none"; }

export function simulateScenario(workflow: WorkflowDocument, scenario: WorkflowScenario): ScenarioRun {
  const index = buildGraphIndex(workflow);
  const failures: string[] = [];
  const warnings: string[] = [];
  const path: string[] = [];
  const branchesTaken: string[] = [];
  const branchesSkipped: string[] = [];
  const unresolvedDecisions: string[] = [];
  const humanReviewPauses: string[] = [];
  const policyChecks: PolicyCheck[] = [];
  const outputs: string[] = [];
  const trace: TraceEvent[] = [];
  const traversedEdges = new Set<string>();
  let currentId = scenario.startingTrigger;
  let terminalResult: string | null = null;
  let elapsedSlaMinutes = 0;

  if (!index.nodesById.has(currentId)) failures.push(`Starting trigger ${currentId || "(missing)"} does not exist.`);

  for (let step = 0; step < 200 && currentId && !failures.length; step += 1) {
    const node = index.nodesById.get(currentId);
    if (!node) { failures.push(`Node ${currentId} does not exist.`); break; }
    path.push(node.id);
    elapsedSlaMinutes += node.slaMinutes ?? 0;
    outputs.push(...node.outputs.filter((output) => !outputs.includes(output)));
    if (node.humanRequired || node.type === "human_review" || node.type === "approval") humanReviewPauses.push(node.id);
    for (const policyId of node.policyRefs) policyChecks.push({ nodeId: node.id, policyId, result: workflow.policies.some((policy) => policy.id === policyId) ? "passed" : "missing" });

    let decision = "";
    let selectedEdge = null as ReturnType<typeof buildGraphIndex>["validEdges"][number] | null;
    const outgoing = index.outgoing.get(node.id) ?? [];

    if (node.type === "terminal") terminalResult = node.id;
    else if (node.type === "decision") {
      decision = scenario.decisionOutcomes[node.id] ?? "";
      selectedEdge = decision
        ? outgoing.find((edge) => edge.condition === decision || edge.label === decision) ?? outgoing.find((edge) => edge.fallback) ?? null
        : null;
      if (!selectedEdge) {
        unresolvedDecisions.push(node.id);
        failures.push(decision
          ? `Decision ${node.title} has no matching or fallback branch.`
          : `Decision ${node.title} needs an explicit scenario outcome.`);
      }
    } else selectedEdge = outgoing[0] ?? null;

    if (selectedEdge) {
      branchesTaken.push(selectedEdge.id);
      for (const edge of outgoing) if (edge.id !== selectedEdge.id) branchesSkipped.push(edge.id);
      if (traversedEdges.has(selectedEdge.id)) {
        warnings.push(`Cycle detected at edge ${selectedEdge.id}; replay stopped.`);
        failures.push("Simulation entered a cycle without a modeled exit.");
      }
      traversedEdges.add(selectedEdge.id);
    } else if (node.type !== "terminal" && !failures.length) failures.push(`${node.title} is a dead end.`);

    const traceEvent: TraceEvent = {
      sequence: trace.length + 1, nodeId: node.id, nodeType: node.type, action: node.title,
      inputSummary: summarize(node.inputs), outputSummary: summarize(node.outputs), decision,
      policyResult: node.policyRefs.length ? policyChecks.filter((check) => check.nodeId === node.id).map((check) => `${check.policyId}:${check.result}`).join(", ") : "not-required",
      humanReviewState: humanReviewPauses.includes(node.id) ? "paused" : "not-required", warnings: [...warnings],
      durationEstimate: node.slaMinutes ?? 0,
    };
    trace.push(traceEvent);
    if (terminalResult || !selectedEdge) break;
    currentId = selectedEdge.target;
  }

  if (path.length >= 200 && !terminalResult && !failures.length) failures.push("Simulation exceeded the 200-step safety limit.");
  for (const check of policyChecks) if (check.result === "missing") failures.push(`Policy ${check.policyId} is not defined.`);
  if (scenario.expectedTerminalState && terminalResult !== scenario.expectedTerminalState) failures.push(`Expected terminal ${scenario.expectedTerminalState}, reached ${terminalResult ?? "none"}.`);
  for (const expected of scenario.expectedHumanReviewPoints) if (!humanReviewPauses.includes(expected)) failures.push(`Expected human review ${expected} was not reached.`);
  for (const expected of scenario.expectedOutputs) if (!outputs.includes(expected)) failures.push(`Expected output ${expected} was not produced.`);

  return {
    id: `run-${scenario.id}-${path.join("-") || "empty"}`, scenarioId: scenario.id, scenarioName: scenario.name,
    passed: failures.length === 0, path, branchesTaken, branchesSkipped, unresolvedDecisions, humanReviewPauses,
    policyChecks, terminalResult, elapsedSlaMinutes, outputs, warnings, failures, trace,
  };
}
