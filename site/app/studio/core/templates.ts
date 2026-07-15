import type { NodeType, RiskLevel, WorkflowDocument, WorkflowNode, WorkflowScenario } from "./types";

const stamp = "2026-07-15T12:00:00.000Z";

export function makeNode(
  id: string,
  type: NodeType,
  title: string,
  x: number,
  y: number,
  overrides: Partial<WorkflowNode> = {},
): WorkflowNode {
  return {
    id, type, title, description: "", owner: "operations", system: "workspace", inputs: [], outputs: [],
    policyRefs: [], slaMinutes: type === "terminal" ? 0 : 10, riskLevel: "low" as RiskLevel,
    humanRequired: type === "human_review" || type === "approval", evidence: [], position: { x, y }, metadata: {},
    ...overrides,
  };
}

function scenarios(triggerId: string, decisionId: string, routineTerminal: string, urgentTerminal: string, reviewId: string): WorkflowScenario[] {
  return [
    { id: "scenario-happy", name: "Happy path", description: "Routine request resolves normally.", startingTrigger: triggerId, inputVariables: { urgency: "normal" }, decisionOutcomes: { [decisionId]: "routine" }, expectedTerminalState: routineTerminal, expectedHumanReviewPoints: [], expectedOutputs: ["resolved" ] },
    { id: "scenario-missing", name: "Missing data", description: "Required classification data is absent.", startingTrigger: triggerId, inputVariables: {}, decisionOutcomes: {}, expectedTerminalState: "", expectedHumanReviewPoints: [], expectedOutputs: [] },
    { id: "scenario-urgent", name: "Urgent high-risk", description: "Urgent request requires a person.", startingTrigger: triggerId, inputVariables: { urgency: "urgent" }, decisionOutcomes: { [decisionId]: "urgent" }, expectedTerminalState: urgentTerminal, expectedHumanReviewPoints: [reviewId], expectedOutputs: ["escalated"] },
    { id: "scenario-rejected", name: "Rejected approval", description: "A reviewer rejects the requested action.", startingTrigger: triggerId, inputVariables: { approval: "rejected" }, decisionOutcomes: { [decisionId]: "routine" }, expectedTerminalState: routineTerminal, expectedHumanReviewPoints: [], expectedOutputs: ["resolved"] },
    { id: "scenario-timeout", name: "Timeout", description: "The workflow exceeds its target SLA.", startingTrigger: triggerId, inputVariables: { timeout: "true" }, decisionOutcomes: { [decisionId]: "urgent" }, expectedTerminalState: urgentTerminal, expectedHumanReviewPoints: [reviewId], expectedOutputs: ["escalated"] },
  ];
}

export function createSupportTriageDocument(): WorkflowDocument {
  const nodes = [
    makeNode("trigger-ticket", "trigger", "Support ticket received", 40, 180, { system: "shared inbox", outputs: ["ticket"] }),
    makeNode("decision-ticket-type", "decision", "Classify urgency", 300, 180, { inputs: ["ticket"], policyRefs: ["policy-support-data"] }),
    makeNode("action-routine", "action", "Route to support queue", 570, 80, { owner: "support", system: "help desk", outputs: ["resolved"], metadata: { errorPath: "exception-routing" } }),
    makeNode("review-urgent", "human_review", "Review urgent request", 570, 280, { owner: "support lead", system: "help desk", riskLevel: "high", policyRefs: ["policy-support-data"], slaMinutes: 5 }),
    makeNode("notification-alert", "notification", "Alert escalation channel", 820, 280, { owner: "support lead", system: "Slack", metadata: { recipient: "#support-escalations" }, outputs: ["escalated"] }),
    makeNode("exception-routing", "exception", "Routing failure", 820, 470, { owner: "support lead", system: "help desk", metadata: { rejoin: "terminal-error" } }),
    makeNode("terminal-resolved", "terminal", "Resolved", 1080, 80, { owner: "support", system: "help desk" }),
    makeNode("terminal-escalated", "terminal", "Escalated for action", 1080, 280, { owner: "support lead", system: "help desk" }),
    makeNode("terminal-error", "terminal", "Manual recovery", 1080, 470, { owner: "support lead", system: "help desk" }),
  ];
  return {
    schemaVersion: 1, id: "template-support-triage", name: "Support triage", description: "Route routine and urgent support requests with explicit review.", version: "1.0.0", createdAt: stamp, updatedAt: stamp,
    nodes,
    edges: [
      { id: "edge-1", source: "trigger-ticket", target: "decision-ticket-type", condition: "", priority: 1, label: "classify", fallback: false, metadata: {} },
      { id: "edge-2", source: "decision-ticket-type", target: "action-routine", condition: "routine", priority: 1, label: "routine", fallback: true, metadata: {} },
      { id: "edge-3", source: "decision-ticket-type", target: "review-urgent", condition: "urgent", priority: 2, label: "urgent", fallback: false, metadata: {} },
      { id: "edge-4", source: "action-routine", target: "terminal-resolved", condition: "", priority: 1, label: "done", fallback: false, metadata: {} },
      { id: "edge-5", source: "review-urgent", target: "notification-alert", condition: "", priority: 1, label: "approved", fallback: false, metadata: {} },
      { id: "edge-6", source: "notification-alert", target: "terminal-escalated", condition: "", priority: 1, label: "sent", fallback: false, metadata: {} },
      { id: "edge-7", source: "exception-routing", target: "terminal-error", condition: "", priority: 1, label: "recover", fallback: false, metadata: {} },
      { id: "edge-8", source: "action-routine", target: "exception-routing", condition: "error", priority: 2, label: "error", fallback: false, metadata: {} },
    ],
    scenarios: scenarios("trigger-ticket", "decision-ticket-type", "terminal-resolved", "terminal-escalated", "review-urgent"),
    policies: [{ id: "policy-support-data", title: "Support data handling", description: "Customer details stay in approved systems.", owner: "operations", scope: "support", evidence: [], metadata: {} }],
    analytics: { tags: ["support", "operations"], lastAnalyzedAt: null, analysisRuns: 0 }, suppressedRuleIds: [],
  };
}

const templateContent = {
  "lead-qualification": {
    titles: ["Lead received", "Check qualification", "Assign qualified lead", "Review strategic lead", "Notify account owner", "Lead routing failure", "Qualified follow-up", "Strategic review", "Manual lead recovery"],
    owners: ["sales ops", "sales ops", "account executive", "sales lead", "sales lead", "sales ops", "account executive", "sales lead", "sales ops"],
    systems: ["CRM", "CRM", "CRM", "CRM", "Slack", "CRM", "CRM", "CRM", "CRM"],
    outputs: ["qualified", "strategic"], policy: "Lead data handling", scope: "sales",
  },
  "customer-intake": {
    titles: ["Client intake received", "Check intake completeness", "Create client task", "Review incomplete intake", "Request missing details", "Intake routing failure", "Task created", "Details requested", "Manual intake recovery"],
    owners: ["client ops", "client ops", "project manager", "client ops lead", "client ops", "client ops lead", "project manager", "client ops", "client ops lead"],
    systems: ["intake form", "workspace", "Linear", "workspace", "Gmail", "workspace", "Linear", "Gmail", "workspace"],
    outputs: ["task_created", "details_requested"], policy: "Client intake handling", scope: "client operations",
  },
  "invoice-approval": {
    titles: ["Invoice received", "Check invoice risk", "Prepare approved invoice", "Approve high-risk invoice", "Notify finance owner", "Invoice routing failure", "Ready for payment", "Finance review complete", "Manual invoice recovery"],
    owners: ["finance ops", "finance ops", "accounts payable", "finance lead", "finance lead", "finance ops", "accounts payable", "finance lead", "finance ops"],
    systems: ["inbox", "accounting", "accounting", "accounting", "Slack", "accounting", "accounting", "accounting", "accounting"],
    outputs: ["payment_ready", "finance_reviewed"], policy: "Invoice approval policy", scope: "finance",
  },
  "incident-escalation": {
    titles: ["Incident reported", "Assess incident severity", "Open incident response", "Review critical incident", "Alert incident channel", "Incident routing failure", "Response active", "Critical escalation active", "Manual incident recovery"],
    owners: ["operations", "incident commander", "operations", "incident commander", "incident commander", "operations", "operations", "incident commander", "operations"],
    systems: ["monitoring", "incident tool", "incident tool", "incident tool", "Slack", "incident tool", "incident tool", "incident tool", "incident tool"],
    outputs: ["response_active", "critical_escalation"], policy: "Incident response policy", scope: "reliability",
  },
} as const;

function themedTemplate(key: keyof typeof templateContent, name: string, description: string): WorkflowDocument {
  const document = createSupportTriageDocument();
  const content = templateContent[key];
  document.id = `template-${key}`;
  document.name = name;
  document.description = description;
  document.analytics.tags = key.split("-");
  document.nodes = document.nodes.map((node, index) => ({
    ...node, title: content.titles[index], owner: content.owners[index], system: content.systems[index],
    outputs: node.id === "action-routine" ? [content.outputs[0]] : node.id === "notification-alert" ? [content.outputs[1]] : node.outputs,
  }));
  document.policies = [{ ...document.policies[0], title: content.policy, scope: content.scope }];
  document.scenarios = document.scenarios.map((scenario) => ({
    ...scenario,
    expectedOutputs: scenario.expectedOutputs.map((output) => output === "resolved" ? content.outputs[0] : output === "escalated" ? content.outputs[1] : output),
  }));
  return document;
}

function invoiceTemplate(): WorkflowDocument {
  const document = themedTemplate("invoice-approval", "Invoice approval", "Review invoices before payment is prepared.");
  document.nodes = document.nodes.map((node) => node.id === "review-urgent" ? { ...node, type: "approval", title: "Approve invoice", metadata: { approver: "finance lead" } } : node);
  return document;
}

export const workflowTemplates = [
  { key: "support-triage", name: "Support triage", document: createSupportTriageDocument() },
  { key: "lead-qualification", name: "Lead qualification", document: themedTemplate("lead-qualification", "Lead qualification", "Classify leads and make follow-up ownership explicit.") },
  { key: "customer-intake", name: "Customer intake", document: themedTemplate("customer-intake", "Customer intake", "Route complete and incomplete customer requests.") },
  { key: "invoice-approval", name: "Invoice approval", document: invoiceTemplate() },
  { key: "incident-escalation", name: "Incident escalation", document: themedTemplate("incident-escalation", "Incident escalation", "Escalate high-risk incidents with human review.") },
] as const;

export function createBlankWorkflow(): WorkflowDocument {
  const now = new Date().toISOString();
  return { schemaVersion: 1, id: `workflow-${Date.now()}`, name: "Untitled workflow", description: "", version: "0.1.0", createdAt: now, updatedAt: now, nodes: [], edges: [], scenarios: [], policies: [], analytics: { tags: [], lastAnalyzedAt: null, analysisRuns: 0 }, suppressedRuleIds: [] };
}
