export type Finding = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  recommendation: string;
  nodes?: string[];
};

type N8nNode = { name?: string; type?: string; disabled?: boolean; credentials?: Record<string, unknown> };
type N8nWorkflow = { name?: string; nodes?: unknown[]; connections?: Record<string, unknown> };

function nodeType(node: N8nNode): string {
  return typeof node.type === "string" ? node.type.toLowerCase() : "";
}

function nodeName(node: N8nNode, index: number): string {
  return typeof node.name === "string" && node.name.trim() ? node.name.trim() : `Node ${index + 1}`;
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function isEnabled(node: N8nNode): boolean {
  return node.disabled !== true;
}

function isTrigger(type: string): boolean {
  if (includesAny(type, ["respondtowebhook", "webhookresponse"])) return false;
  return includesAny(type, ["trigger", "webhook", "schedule", "manualtrigger"]);
}

function countConnections(connections: Record<string, unknown>): number {
  let count = 0;
  for (const source of Object.values(connections)) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const groups of Object.values(source)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) if (Array.isArray(group)) count += group.length;
    }
  }
  return count;
}

export function analyzeN8nText(text: string) {
  const parsed = JSON.parse(text) as N8nWorkflow;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.nodes)) {
    throw new Error("This does not look like an n8n workflow: nodes[] is missing.");
  }
  if (parsed.nodes.length === 0) throw new Error("The workflow contains no nodes.");
  if (parsed.nodes.length > 5000) throw new Error("The workflow exceeds the 5,000-node safety limit.");

  const nodes = parsed.nodes.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Node ${index + 1} is invalid.`);
    return value as N8nNode;
  });
  const names = nodes.map(nodeName);
  const types = nodes.map(nodeType);
  const enabled = nodes.map(isEnabled);
  const findings: Finding[] = [];
  const connections = parsed.connections && typeof parsed.connections === "object" && !Array.isArray(parsed.connections) ? parsed.connections : {};
  const connectionCount = countConnections(connections);

  if (!nodes.some((node, index) => enabled[index] && isTrigger(types[index]))) {
    findings.push({ id: "N8N001", severity: "critical", title: "No enabled trigger detected", detail: "No enabled trigger, webhook, schedule, or manual trigger node was found.", recommendation: "Add and enable an explicit trigger." });
  }
  if (nodes.length > 1 && connectionCount === 0) {
    findings.push({ id: "N8N002", severity: "critical", title: "Workflow nodes are not connected", detail: `${nodes.length} nodes exist but no executable connections were found.`, recommendation: "Connect the intended execution paths." });
  }

  const disabledNames = nodes.map((node, index) => ({ node, index })).filter(({ node }) => !isEnabled(node)).map(({ index }) => names[index]);
  if (disabledNames.length) findings.push({ id: "N8N004", severity: "low", title: "Disabled nodes remain", detail: `${disabledNames.length} disabled node${disabledNames.length === 1 ? " remains" : "s remain"}.`, recommendation: "Confirm they are intentional or remove them.", nodes: disabledNames.slice(0, 12) });

  const risky = types.map((type, index) => ({ type, index })).filter(({ type, index }) => enabled[index] && includesAny(type, ["function", "code", "executecommand", "ssh"])).map(({ index }) => names[index]);
  if (risky.length) findings.push({ id: "N8N005", severity: "high", title: "Code or command execution requires review", detail: `${risky.length} enabled node${risky.length === 1 ? " can" : "s can"} execute custom code or commands.`, recommendation: "Review validation, secrets, network access, timeouts, and injection boundaries.", nodes: risky.slice(0, 12) });

  const ai = types.map((type, index) => ({ type, index })).filter(({ type, index }) => enabled[index] && includesAny(type, ["langchain", "openai", "agent", "llm", "anthropic"])).map(({ index }) => names[index]);
  const hasReview = types.some((type, index) => enabled[index] && includesAny(type, ["wait", "form", "approval", "human"]));
  if (ai.length && !hasReview) findings.push({ id: "N8N006", severity: "high", title: "AI actions have no human-review gate", detail: "Enabled AI nodes were found without an enabled wait, approval, form, or human-review step.", recommendation: "Add explicit review before irreversible or customer-facing actions.", nodes: ai.slice(0, 12) });

  const http = types.map((type, index) => ({ type, index })).filter(({ type, index }) => enabled[index] && includesAny(type, ["httprequest", "graphql"])).map(({ index }) => names[index]);
  const hasError = types.some((type, index) => enabled[index] && includesAny(type, ["errortrigger", "stopanderror"]));
  if (http.length && !hasError) findings.push({ id: "N8N007", severity: "medium", title: "External calls lack an explicit error path", detail: "External calls were found without an enabled error trigger or stop-and-error node.", recommendation: "Add retries, timeout handling, failure notification, and a deterministic fallback.", nodes: http.slice(0, 12) });

  const credentials = nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.credentials && Object.keys(node.credentials).length).map(({ index }) => names[index]);
  if (credentials.length) findings.push({ id: "N8N008", severity: "low", title: "Credential references are present", detail: "The workflow references credentials. SolveLang does not inspect credential values.", recommendation: "Confirm least privilege and rotate any plaintext secret found in the export.", nodes: credentials.slice(0, 12) });

  if (!findings.length) findings.push({ id: "N8N000", severity: "low", title: "No known structural finding", detail: "The deterministic scan did not identify a known structural issue.", recommendation: "Run scenario and production-environment tests separately." });

  const penalties = { critical: 25, high: 15, medium: 8, low: 3 } as const;
  const score = Math.max(0, 100 - findings.reduce((sum, finding) => sum + penalties[finding.severity], 0));
  return { schema: "solvelang.mcp.n8n-preflight.v1", workflowName: parsed.name?.trim() || "Untitled n8n workflow", nodeCount: nodes.length, connectionCount, score, findings };
}
