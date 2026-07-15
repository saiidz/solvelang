import { buildGraphIndex, canReachType, findCycles, reachableNodes } from "./graph";
import type { AnalysisFinding, ExplainableScore, Severity, WorkflowAnalysis, WorkflowDocument } from "./types";

const RULES = [
  ["SL001", "No trigger", "error"], ["SL002", "Multiple uncoordinated triggers", "warning"],
  ["SL003", "No terminal state", "error"], ["SL004", "Unreachable node", "error"],
  ["SL005", "Dead-end node", "warning"], ["SL006", "Decision without fallback", "warning"],
  ["SL007", "Overlapping decision conditions", "warning"], ["SL008", "Empty decision branch", "error"],
  ["SL009", "Cycle without exit condition", "error"], ["SL010", "Human review required but missing", "error"],
  ["SL011", "Approval step without approver", "error"], ["SL012", "Action without owner", "warning"],
  ["SL013", "System action without system", "warning"], ["SL014", "Input used without source", "warning"],
  ["SL015", "Output produced without destination", "warning"], ["SL016", "Missing error path", "recommendation"],
  ["SL017", "Missing timeout or SLA", "recommendation"], ["SL018", "High-risk action without human review", "error"],
  ["SL019", "Sensitive-data step without policy", "error"], ["SL020", "Notification without recipient", "warning"],
  ["SL021", "Exception path never rejoins or terminates", "warning"], ["SL022", "Duplicate node identifier", "error"],
  ["SL023", "Invalid edge reference", "error"], ["SL024", "Orphan node", "warning"],
  ["SL025", "Unused policy", "recommendation"],
] as const satisfies ReadonlyArray<readonly [string, string, Severity]>;

const remediation: Record<string, string> = {
  SL001: "Add one trigger that names the event starting the workflow.", SL002: "Coordinate triggers through one entry decision or shared coordination key.",
  SL003: "Add at least one explicit terminal outcome.", SL004: "Connect the node to a trigger-reachable path or remove it.",
  SL005: "Connect the node to a next step, exception, or terminal.", SL006: "Mark one outgoing decision edge as the fallback.",
  SL007: "Make outgoing decision conditions mutually exclusive.", SL008: "Give every decision branch a condition, label, or fallback target.",
  SL009: "Add a conditional exit edge from the cycle.", SL010: "Add a human-review or approval node after the flagged step.",
  SL011: "Name the approver in the approval node metadata.", SL012: "Assign an accountable owner.",
  SL013: "Name the system that performs the step.", SL014: "Name the input source.", SL015: "Name the output destination.",
  SL016: "Connect an exception path or name an error path.", SL017: "Set a modeled SLA in minutes.",
  SL018: "Require human review or route the action through a review node.", SL019: "Reference an applicable data policy.",
  SL020: "Name the notification recipient.", SL021: "Rejoin the main path or end at a terminal.",
  SL022: "Assign a unique stable ID to every node.", SL023: "Point the edge to existing source and target nodes.",
  SL024: "Connect the node to the graph or remove it.", SL025: "Reference the policy from a node or remove it.",
};

type FindingSeed = { ruleId: string; affectedType?: AnalysisFinding["affectedType"]; affectedId?: string | null; evidence: string[]; explanation?: string };

function finding(workflow: WorkflowDocument, seed: FindingSeed): AnalysisFinding {
  const rule = RULES.find(([id]) => id === seed.ruleId)!;
  const suppressible = rule[2] !== "error";
  const suppressed = suppressible && workflow.suppressedRuleIds.includes(seed.ruleId);
  return {
    id: `${seed.ruleId}:${seed.affectedId ?? workflow.id}`, ruleId: seed.ruleId, severity: rule[2],
    status: suppressed ? "suppressed" : "open", affectedType: seed.affectedType ?? "workflow",
    affectedId: seed.affectedId ?? null, title: rule[1],
    explanation: seed.explanation ?? `${rule[1]} reduces workflow clarity or operational safety.`,
    remediation: remediation[seed.ruleId], evidence: seed.evidence, suppressible, suppressed,
  };
}

function ratio(count: number, total: number) { return total === 0 ? 1 : count / total; }

export function calculateReadinessScore(
  findings: Array<{ severity: Severity; suppressed: boolean }>,
  coverage: WorkflowAnalysis["coverage"],
): ExplainableScore {
  const active = findings.filter((item) => !item.suppressed);
  const errors = active.filter((item) => item.severity === "error").length;
  const warnings = active.filter((item) => item.severity === "warning").length;
  const recommendations = active.filter((item) => item.severity === "recommendation").length;
  const severityRaw = errors * 12 + warnings * 5 + recommendations * 2;
  const factors = [
    { label: "Error findings", value: errors, weight: 12, deduction: Math.min(50, errors * 12), explanation: "12 points per unsuppressed error." },
    { label: "Warning findings", value: warnings, weight: 5, deduction: Math.min(Math.max(0, 50 - errors * 12), warnings * 5), explanation: "5 points per unsuppressed warning within the 50-point finding cap." },
    { label: "Recommendations", value: recommendations, weight: 2, deduction: Math.min(Math.max(0, 50 - errors * 12 - warnings * 5), recommendations * 2), explanation: "2 points per unsuppressed recommendation within the 50-point finding cap." },
    { label: "Owner coverage", value: coverage.owner, weight: 15, deduction: Math.round((1 - coverage.owner) * 15), explanation: "Up to 15 points for missing owners." },
    { label: "SLA coverage", value: coverage.sla, weight: 10, deduction: Math.round((1 - coverage.sla) * 10), explanation: "Up to 10 points for missing SLAs." },
    { label: "Fallback coverage", value: coverage.fallback, weight: 10, deduction: Math.round((1 - coverage.fallback) * 10), explanation: "Up to 10 points for decisions without fallbacks." },
    { label: "Policy coverage", value: coverage.policy, weight: 10, deduction: Math.round((1 - coverage.policy) * 10), explanation: "Up to 10 points for sensitive steps without policy references." },
    { label: "Terminal availability", value: coverage.terminal, weight: 5, deduction: Math.round((1 - coverage.terminal) * 5), explanation: "5 points when no terminal exists." },
  ];
  const findingDeduction = Math.min(50, severityRaw);
  const coverageDeduction = factors.slice(3).reduce((sum, item) => sum + item.deduction, 0);
  return { value: Math.max(0, 100 - findingDeduction - coverageDeduction), formula: "100 − capped finding deductions (50) − owner/SLA/fallback/policy/terminal coverage deductions (50)", factors };
}

export function analyzeWorkflow(workflow: WorkflowDocument): WorkflowAnalysis {
  const index = buildGraphIndex(workflow);
  const findings: AnalysisFinding[] = [];
  const add = (seed: FindingSeed) => findings.push(finding(workflow, seed));
  const triggers = workflow.nodes.filter((node) => node.type === "trigger");
  const terminals = workflow.nodes.filter((node) => node.type === "terminal");

  if (!triggers.length) add({ ruleId: "SL001", evidence: ["No node has type trigger."] });
  if (triggers.length > 1) {
    const keys = new Set(triggers.map((node) => node.metadata.coordination).filter(Boolean));
    if (keys.size !== 1 || triggers.some((node) => !node.metadata.coordination)) add({ ruleId: "SL002", evidence: triggers.map((node) => node.id) });
  }
  if (!terminals.length) add({ ruleId: "SL003", evidence: ["No node has type terminal."] });

  const reachable = reachableNodes(index, triggers.map((node) => node.id));
  for (const node of workflow.nodes) if (triggers.length && !reachable.has(node.id)) add({ ruleId: "SL004", affectedType: "node", affectedId: node.id, evidence: [`${node.title} is not reachable from a trigger.`] });
  for (const node of workflow.nodes) {
    const outgoing = index.outgoing.get(node.id) ?? [];
    if (node.type !== "terminal" && reachable.has(node.id) && !outgoing.length) add({ ruleId: "SL005", affectedType: "node", affectedId: node.id, evidence: [`${node.title} has no outgoing edge.`] });
    if (node.type === "decision") {
      if (!outgoing.some((edge) => edge.fallback)) add({ ruleId: "SL006", affectedType: "node", affectedId: node.id, evidence: [`${node.title} has no fallback edge.`] });
      const conditions = outgoing.map((edge) => edge.condition.trim()).filter(Boolean);
      if (new Set(conditions).size !== conditions.length) add({ ruleId: "SL007", affectedType: "node", affectedId: node.id, evidence: conditions });
      for (const edge of outgoing) if (!edge.fallback && !edge.condition.trim() && !edge.label.trim()) add({ ruleId: "SL008", affectedType: "edge", affectedId: edge.id, evidence: [`${edge.id} has no condition or label.`] });
    }
    if (node.humanRequired && !["human_review", "approval"].includes(node.type) && !canReachType(index, node.id, new Set(["human_review", "approval"]))) add({ ruleId: "SL010", affectedType: "node", affectedId: node.id, evidence: [`${node.title} requires human review but none is downstream.`] });
    if (node.type === "approval" && !node.metadata.approver?.trim()) add({ ruleId: "SL011", affectedType: "node", affectedId: node.id, evidence: [`${node.title} has no approver.`] });
    if (node.type === "action" && !node.owner.trim()) add({ ruleId: "SL012", affectedType: "node", affectedId: node.id, evidence: [`${node.title} has no owner.`] });
    if ((node.type === "system" || node.metadata.systemAction === "true") && !node.system.trim()) add({ ruleId: "SL013", affectedType: "node", affectedId: node.id, evidence: [`${node.title} has no system.`] });
    if (node.type === "data_input" && !node.metadata.source?.trim()) add({ ruleId: "SL014", affectedType: "node", affectedId: node.id, evidence: [`${node.title} has no input source.`] });
    if (node.type === "data_output" && !node.metadata.destination?.trim()) add({ ruleId: "SL015", affectedType: "node", affectedId: node.id, evidence: [`${node.title} has no output destination.`] });
    if (["action", "system"].includes(node.type) && !node.metadata.errorPath && !outgoing.some((edge) => index.nodesById.get(edge.target)?.type === "exception")) add({ ruleId: "SL016", affectedType: "node", affectedId: node.id, evidence: [`${node.title} has no error path.`] });
    if (node.type !== "terminal" && node.slaMinutes === null) add({ ruleId: "SL017", affectedType: "node", affectedId: node.id, evidence: [`${node.title} has no SLA.`] });
    if (node.type === "action" && ["high", "critical"].includes(node.riskLevel) && !node.humanRequired && !canReachType(index, node.id, new Set(["human_review", "approval"]))) add({ ruleId: "SL018", affectedType: "node", affectedId: node.id, evidence: [`${node.title} is ${node.riskLevel} risk without review.`] });
    if (node.metadata.sensitiveData === "true" && !node.policyRefs.length) add({ ruleId: "SL019", affectedType: "node", affectedId: node.id, evidence: [`${node.title} handles sensitive data without policy.`] });
    if (node.type === "notification" && !node.metadata.recipient?.trim()) add({ ruleId: "SL020", affectedType: "node", affectedId: node.id, evidence: [`${node.title} has no recipient.`] });
    if (node.type === "exception" && !node.metadata.rejoin && !canReachType(index, node.id, new Set(["terminal"]))) add({ ruleId: "SL021", affectedType: "node", affectedId: node.id, evidence: [`${node.title} neither rejoins nor terminates.`] });
  }

  for (const cycle of findCycles(index)) {
    const cycleSet = new Set(cycle);
    const hasExit = cycle.some((id) => (index.outgoing.get(id) ?? []).some((edge) => !cycleSet.has(edge.target) && Boolean(edge.condition || edge.metadata.exitCondition)));
    if (!hasExit) add({ ruleId: "SL009", affectedType: "node", affectedId: cycle[0], evidence: [`Cycle: ${cycle.join(" → ")}`] });
  }

  const counts = new Map<string, number>();
  for (const node of workflow.nodes) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
  for (const [id, count] of counts) if (count > 1) add({ ruleId: "SL022", affectedType: "node", affectedId: id, evidence: [`${id} appears ${count} times.`] });
  for (const edge of workflow.edges) if (!index.nodesById.has(edge.source) || !index.nodesById.has(edge.target)) add({ ruleId: "SL023", affectedType: "edge", affectedId: edge.id, evidence: [`${edge.source} → ${edge.target}`] });
  for (const node of workflow.nodes) if (!(index.incoming.get(node.id)?.length) && !(index.outgoing.get(node.id)?.length) && workflow.nodes.length > 1) add({ ruleId: "SL024", affectedType: "node", affectedId: node.id, evidence: [`${node.title} has no edges.`] });
  const usedPolicies = new Set(workflow.nodes.flatMap((node) => node.policyRefs));
  for (const policy of workflow.policies) if (!usedPolicies.has(policy.id)) add({ ruleId: "SL025", affectedType: "policy", affectedId: policy.id, evidence: [`${policy.title} is not referenced.`] });

  const ownerNodes = workflow.nodes.filter((node) => !["trigger", "terminal", "policy"].includes(node.type));
  const slaNodes = workflow.nodes.filter((node) => node.type !== "terminal");
  const decisions = workflow.nodes.filter((node) => node.type === "decision");
  const sensitive = workflow.nodes.filter((node) => node.metadata.sensitiveData === "true");
  const coverage = {
    owner: ratio(ownerNodes.filter((node) => node.owner.trim()).length, ownerNodes.length),
    sla: ratio(slaNodes.filter((node) => node.slaMinutes !== null).length, slaNodes.length),
    fallback: ratio(decisions.filter((node) => (index.outgoing.get(node.id) ?? []).some((edge) => edge.fallback)).length, decisions.length),
    policy: ratio(sensitive.filter((node) => node.policyRefs.length).length, sensitive.length), terminal: terminals.length ? 1 : 0,
  };
  const passedChecks = RULES.filter(([ruleId]) => !findings.some((item) => item.ruleId === ruleId)).map(([ruleId, title]) => ({ ruleId, title }));
  return { findings, passedChecks, coverage, score: calculateReadinessScore(findings, coverage) };
}
