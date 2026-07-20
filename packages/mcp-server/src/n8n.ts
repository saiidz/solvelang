export const MAX_N8N_BYTES = 2 * 1024 * 1024;
export const MAX_N8N_NODES = 5000;

export type Finding = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  recommendation: string;
  evidence: string;
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

function connectedNames(connections: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const [sourceName, source] of Object.entries(connections)) {
    names.add(sourceName);
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const groups of Object.values(source)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!Array.isArray(group)) continue;
        for (const target of group) {
          if (target && typeof target === "object" && !Array.isArray(target) && typeof (target as { node?: unknown }).node === "string") {
            names.add((target as { node: string }).node);
          }
        }
      }
    }
  }
  return names;
}

function terminalNames(connections: Record<string, unknown>): Set<string> {
  const targets = new Set<string>();
  const sources = new Set(Object.keys(connections));
  for (const source of Object.values(connections)) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const groups of Object.values(source)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!Array.isArray(group)) continue;
        for (const target of group) {
          if (target && typeof target === "object" && !Array.isArray(target) && typeof (target as { node?: unknown }).node === "string") {
            targets.add((target as { node: string }).node);
          }
        }
      }
    }
  }
  return new Set([...targets].filter((name) => !sources.has(name)));
}

function parseWorkflow(text: string): N8nWorkflow {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_N8N_BYTES) throw new Error("The workflow exceeds the 2 MB safety limit.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The workflow is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray((parsed as N8nWorkflow).nodes)) {
    throw new Error("This does not look like an n8n workflow: nodes[] is missing.");
  }
  const connections = (parsed as N8nWorkflow).connections;
  if (connections !== undefined && (!connections || typeof connections !== "object" || Array.isArray(connections))) {
    throw new Error("The workflow connections field must be an object.");
  }
  return parsed as N8nWorkflow;
}

export function analyzeN8nText(text: string) {
  const parsed = parseWorkflow(text);
  if (parsed.nodes!.length === 0) throw new Error("The workflow contains no nodes.");
  if (parsed.nodes!.length > MAX_N8N_NODES) throw new Error("The workflow exceeds the 5,000-node safety limit.");

  const nodes = parsed.nodes!.map((value, index) => {
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
    findings.push({ id: "N8N001", severity: "critical", title: "No enabled trigger detected", detail: "No enabled trigger, webhook, schedule, or manual trigger node was found.", recommendation: "Add and enable an explicit trigger.", evidence: "Enabled trigger count: 0" });
  }
  if (nodes.length > 1 && connectionCount === 0) {
    findings.push({ id: "N8N002", severity: "critical", title: "Workflow nodes are not connected", detail: `${nodes.length} nodes exist but no executable connections were found.`, recommendation: "Connect the intended execution paths.", evidence: `Node count: ${nodes.length}; connection count: 0` });
  }

  const connected = connectedNames(connections);
  const disconnected = names.filter((name) => !connected.has(name));
  if (nodes.length > 1 && disconnected.length > 0) {
    findings.push({
      id: "N8N003",
      severity: disconnected.length === nodes.length ? "high" : "medium",
      title: "Disconnected nodes detected",
      detail: `${disconnected.length} node${disconnected.length === 1 ? " is" : "s are"} not part of any connection.`,
      recommendation: "Connect intentional nodes or remove abandoned nodes.",
      evidence: `Disconnected node count: ${disconnected.length}`,
      nodes: disconnected.slice(0, 12),
    });
  }

  const disabledNames = nodes.map((node, index) => ({ node, index })).filter(({ node }) => !isEnabled(node)).map(({ index }) => names[index]);
  if (disabledNames.length) findings.push({ id: "N8N004", severity: "low", title: "Disabled nodes remain", detail: `${disabledNames.length} disabled node${disabledNames.length === 1 ? " remains" : "s remain"}.`, recommendation: "Confirm they are intentional or remove them.", evidence: `Disabled node count: ${disabledNames.length}`, nodes: disabledNames.slice(0, 12) });

  const risky = types.map((type, index) => ({ type, index })).filter(({ type, index }) => enabled[index] && includesAny(type, ["function", "code", "executecommand", "ssh"])).map(({ index }) => names[index]);
  if (risky.length) findings.push({ id: "N8N005", severity: "high", title: "Code or command execution requires review", detail: `${risky.length} enabled node${risky.length === 1 ? " can" : "s can"} execute custom code or commands.`, recommendation: "Review validation, secrets, network access, timeouts, and injection boundaries.", evidence: `Enabled code or command nodes: ${risky.length}`, nodes: risky.slice(0, 12) });

  const ai = types.map((type, index) => ({ type, index })).filter(({ type, index }) => enabled[index] && includesAny(type, ["langchain", "openai", "agent", "llm", "anthropic"])).map(({ index }) => names[index]);
  const hasReview = types.some((type, index) => enabled[index] && includesAny(type, ["wait", "form", "approval", "human"]));
  if (ai.length && !hasReview) findings.push({ id: "N8N006", severity: "high", title: "AI actions have no human-review gate", detail: "Enabled AI nodes were found without an enabled wait, approval, form, or human-review step.", recommendation: "Add explicit review before irreversible or customer-facing actions.", evidence: `Enabled AI nodes: ${ai.length}; enabled review gate: false`, nodes: ai.slice(0, 12) });

  const http = types.map((type, index) => ({ type, index })).filter(({ type, index }) => enabled[index] && includesAny(type, ["httprequest", "graphql"])).map(({ index }) => names[index]);
  const hasError = types.some((type, index) => enabled[index] && includesAny(type, ["errortrigger", "stopanderror"]));
  if (http.length && !hasError) findings.push({ id: "N8N007", severity: "medium", title: "External calls lack an explicit error path", detail: "External calls were found without an enabled error trigger or stop-and-error node.", recommendation: "Add retries, timeout handling, failure notification, and a deterministic fallback.", evidence: `Enabled external-call nodes: ${http.length}; enabled error path: false`, nodes: http.slice(0, 12) });

  const credentials = nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.credentials && Object.keys(node.credentials).length).map(({ index }) => names[index]);
  if (credentials.length) findings.push({ id: "N8N008", severity: "low", title: "Credential references are present", detail: "The workflow references credentials. SolveLang does not inspect credential values.", recommendation: "Confirm least privilege and rotate any plaintext secret found in the export.", evidence: `Nodes with credential references: ${credentials.length}`, nodes: credentials.slice(0, 12) });

  if (connectionCount > 0 && terminalNames(connections).size === 0) {
    findings.push({
      id: "N8N009",
      severity: "medium",
      title: "No clear terminal node detected",
      detail: "Every connected target also appears to continue execution, so the workflow may loop or lack a deliberate end state.",
      recommendation: "Confirm loops are bounded and ensure each branch reaches a deliberate terminal outcome.",
      evidence: "Connected terminal node count: 0",
    });
  }

  if (!findings.length) findings.push({ id: "N8N000", severity: "low", title: "No known structural finding", detail: "The deterministic scan did not identify a known structural issue.", recommendation: "Run scenario and production-environment tests separately.", evidence: "Known structural finding count: 0" });

  findings.sort((a, b) => a.id.localeCompare(b.id));
  const penalties = { critical: 25, high: 15, medium: 8, low: 3 } as const;
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) severityCounts[finding.severity] += 1;
  const score = Math.max(0, 100 - findings.reduce((sum, finding) => sum + penalties[finding.severity], 0));
  return {
    schema: "solvelang.mcp.n8n-preflight.v2",
    workflowName: parsed.name?.trim() || "Untitled n8n workflow",
    nodeCount: nodes.length,
    connectionCount,
    score,
    pass: severityCounts.critical === 0 && severityCounts.high === 0,
    severityCounts,
    findings,
  };
}
