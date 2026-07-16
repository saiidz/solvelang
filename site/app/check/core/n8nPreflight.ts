export type PreflightSeverity = "critical" | "high" | "medium" | "low";

export type PreflightFinding = {
  id: string;
  severity: PreflightSeverity;
  title: string;
  detail: string;
  recommendation: string;
  nodeNames?: string[];
};

export type N8nNode = {
  id?: string;
  name?: string;
  type?: string;
  disabled?: boolean;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
};

export type N8nWorkflow = {
  name?: string;
  nodes: N8nNode[];
  connections?: Record<string, Record<string, Array<Array<{ node?: string }>>>>;
  settings?: Record<string, unknown>;
};

export type PreflightReport = {
  schema: "solvelang.n8n-preflight.v1";
  workflowName: string;
  generatedAt: string;
  score: number;
  nodeCount: number;
  connectionCount: number;
  findings: PreflightFinding[];
  severityCounts: Record<PreflightSeverity, number>;
  summary: string;
};

const severityPenalty: Record<PreflightSeverity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeName(node: N8nNode, index: number): string {
  const name = typeof node.name === "string" ? node.name.trim() : "";
  return name || `Node ${index + 1}`;
}

function nodeType(node: N8nNode): string {
  return typeof node.type === "string" ? node.type.toLowerCase() : "";
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function countConnections(workflow: N8nWorkflow): number {
  let count = 0;
  for (const source of Object.values(workflow.connections ?? {})) {
    if (!isRecord(source)) continue;
    for (const groups of Object.values(source)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (Array.isArray(group)) count += group.length;
      }
    }
  }
  return count;
}

function connectedNames(workflow: N8nWorkflow): Set<string> {
  const names = new Set<string>();
  for (const [sourceName, source] of Object.entries(workflow.connections ?? {})) {
    names.add(sourceName);
    if (!isRecord(source)) continue;
    for (const groups of Object.values(source)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!Array.isArray(group)) continue;
        for (const target of group) {
          if (target && typeof target.node === "string") names.add(target.node);
        }
      }
    }
  }
  return names;
}

export function parseN8nWorkflow(input: unknown): N8nWorkflow {
  if (!isRecord(input)) throw new Error("The uploaded file must contain one JSON object.");
  if (!Array.isArray(input.nodes)) throw new Error("This does not look like an n8n workflow: nodes[] is missing.");
  if (input.nodes.length === 0) throw new Error("The workflow contains no nodes.");
  if (input.nodes.length > 5000) throw new Error("The workflow exceeds the 5,000-node safety limit.");

  const nodes = input.nodes.map((value, index) => {
    if (!isRecord(value)) throw new Error(`Node ${index + 1} is not a valid object.`);
    return value as N8nNode;
  });

  const connections = input.connections;
  if (connections !== undefined && !isRecord(connections)) {
    throw new Error("The workflow connections field must be an object.");
  }

  return {
    name: typeof input.name === "string" ? input.name : undefined,
    nodes,
    connections: connections as N8nWorkflow["connections"],
    settings: isRecord(input.settings) ? input.settings : undefined,
  };
}

export function analyzeN8nWorkflow(workflow: N8nWorkflow, now = new Date()): PreflightReport {
  const findings: PreflightFinding[] = [];
  const names = workflow.nodes.map(safeName);
  const types = workflow.nodes.map(nodeType);
  const connected = connectedNames(workflow);
  const connectionCount = countConnections(workflow);

  const triggerIndexes = types
    .map((type, index) => ({ type, index }))
    .filter(({ type }) => includesAny(type, ["trigger", "webhook", "schedule", "manualtrigger"]));

  if (triggerIndexes.length === 0) {
    findings.push({
      id: "N8N001",
      severity: "critical",
      title: "No trigger node detected",
      detail: "The workflow has no recognizable trigger, webhook, schedule, or manual trigger node.",
      recommendation: "Add and configure an explicit trigger so the workflow has a deterministic entry point.",
    });
  }

  if (connectionCount === 0 && workflow.nodes.length > 1) {
    findings.push({
      id: "N8N002",
      severity: "critical",
      title: "Workflow nodes are not connected",
      detail: `${workflow.nodes.length} nodes exist, but no executable connections were found.`,
      recommendation: "Connect the intended execution path and verify each branch reaches a deliberate outcome.",
    });
  }

  const disconnected = names.filter((name) => !connected.has(name));
  if (workflow.nodes.length > 1 && disconnected.length > 0) {
    findings.push({
      id: "N8N003",
      severity: disconnected.length === workflow.nodes.length ? "high" : "medium",
      title: "Disconnected nodes detected",
      detail: `${disconnected.length} node${disconnected.length === 1 ? " is" : "s are"} not part of any connection.`,
      recommendation: "Connect intentional nodes or remove abandoned nodes before deployment.",
      nodeNames: disconnected.slice(0, 12),
    });
  }

  const disabled = workflow.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.disabled === true)
    .map(({ index }) => names[index]);
  if (disabled.length > 0) {
    findings.push({
      id: "N8N004",
      severity: "low",
      title: "Disabled nodes remain in the workflow",
      detail: `${disabled.length} disabled node${disabled.length === 1 ? " remains" : "s remain"} in the exported workflow.`,
      recommendation: "Confirm disabled nodes are intentional or remove them to avoid confusing future maintainers.",
      nodeNames: disabled.slice(0, 12),
    });
  }

  const riskyCodeNodes = types
    .map((type, index) => ({ type, index }))
    .filter(({ type }) => includesAny(type, ["function", "code", "executecommand", "ssh"]))
    .map(({ index }) => names[index]);
  if (riskyCodeNodes.length > 0) {
    findings.push({
      id: "N8N005",
      severity: "high",
      title: "Code or command execution requires review",
      detail: `${riskyCodeNodes.length} node${riskyCodeNodes.length === 1 ? " can" : "s can"} execute custom code or commands.`,
      recommendation: "Review input validation, secrets handling, network access, timeouts, and command injection boundaries.",
      nodeNames: riskyCodeNodes.slice(0, 12),
    });
  }

  const aiNodes = types
    .map((type, index) => ({ type, index }))
    .filter(({ type }) => includesAny(type, ["langchain", "openai", "agent", "llm", "anthropic"]))
    .map(({ index }) => names[index]);
  const reviewNodes = types.filter((type) => includesAny(type, ["wait", "form", "approval", "human"]));
  if (aiNodes.length > 0 && reviewNodes.length === 0) {
    findings.push({
      id: "N8N006",
      severity: "high",
      title: "AI actions have no recognizable human-review gate",
      detail: "AI or agent nodes were found without a wait, approval, form, or human-review step.",
      recommendation: "Add explicit review before irreversible, customer-facing, financial, legal, or destructive actions.",
      nodeNames: aiNodes.slice(0, 12),
    });
  }

  const httpNodes = types
    .map((type, index) => ({ type, index }))
    .filter(({ type }) => includesAny(type, ["httprequest", "webhookresponse", "graphql"]))
    .map(({ index }) => names[index]);
  const errorNodes = types.filter((type) => includesAny(type, ["errortrigger", "stopanderror", "respondtoWebhook".toLowerCase()]));
  if (httpNodes.length > 0 && errorNodes.length === 0) {
    findings.push({
      id: "N8N007",
      severity: "medium",
      title: "External calls lack an explicit error path",
      detail: "The workflow calls external services but no recognizable error trigger or stop-and-error node was found.",
      recommendation: "Add retry limits, timeout handling, failure notification, and a deterministic fallback path.",
      nodeNames: httpNodes.slice(0, 12),
    });
  }

  const credentialNodes = workflow.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => isRecord(node.credentials) && Object.keys(node.credentials ?? {}).length > 0)
    .map(({ index }) => names[index]);
  if (credentialNodes.length > 0) {
    findings.push({
      id: "N8N008",
      severity: "low",
      title: "Credential references are present",
      detail: "Credential metadata is referenced by the exported workflow. SolveLang does not transmit or inspect credential values.",
      recommendation: "Confirm the export contains references only, rotate exposed secrets, and use least-privilege credentials.",
      nodeNames: credentialNodes.slice(0, 12),
    });
  }

  const endTargets = new Set<string>();
  const sources = new Set(Object.keys(workflow.connections ?? {}));
  for (const source of Object.values(workflow.connections ?? {})) {
    if (!isRecord(source)) continue;
    for (const groups of Object.values(source)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!Array.isArray(group)) continue;
        for (const target of group) if (target?.node) endTargets.add(target.node);
      }
    }
  }
  const terminalNodes = names.filter((name) => endTargets.has(name) && !sources.has(name));
  if (connectionCount > 0 && terminalNodes.length === 0) {
    findings.push({
      id: "N8N009",
      severity: "medium",
      title: "No clear terminal node detected",
      detail: "Every connected target also appears to continue execution, so the workflow may loop or lack a deliberate end state.",
      recommendation: "Confirm loops are bounded and ensure each branch reaches an explicit success, failure, or handoff outcome.",
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "N8N000",
      severity: "low",
      title: "No structural preflight findings",
      detail: "The deterministic structural scan did not identify a known issue.",
      recommendation: "Run scenario-specific tests and verify credentials, external APIs, and production data separately.",
    });
  }

  const severityCounts: Record<PreflightSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) severityCounts[finding.severity] += 1;
  const score = Math.max(0, 100 - findings.reduce((total, finding) => total + severityPenalty[finding.severity], 0));
  const actionableCount = findings.filter((finding) => finding.id !== "N8N000").length;

  return {
    schema: "solvelang.n8n-preflight.v1",
    workflowName: workflow.name?.trim() || "Untitled n8n workflow",
    generatedAt: now.toISOString(),
    score,
    nodeCount: workflow.nodes.length,
    connectionCount,
    findings,
    severityCounts,
    summary:
      actionableCount === 0
        ? "No known structural issue was detected. Production behavior still requires environment-specific testing."
        : `${actionableCount} deterministic finding${actionableCount === 1 ? "" : "s"} require review before deployment.`,
  };
}

export function createHtmlReport(report: PreflightReport): string {
  const escapeHtml = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const rows = report.findings
    .map(
      (finding) => `<article><h2>${escapeHtml(finding.severity.toUpperCase())}: ${escapeHtml(finding.title)}</h2><p>${escapeHtml(finding.detail)}</p><p><strong>Recommendation:</strong> ${escapeHtml(finding.recommendation)}</p>${finding.nodeNames?.length ? `<p><strong>Nodes:</strong> ${escapeHtml(finding.nodeNames.join(", "))}</p>` : ""}</article>`,
    )
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(report.workflowName)} — SolveLang Preflight</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#0f172a;line-height:1.55}header,article{border:1px solid #cbd5e1;border-radius:16px;padding:20px;margin:18px 0}small{color:#64748b}.score{font-size:3rem;font-weight:700}</style></head><body><header><small>SolveLang Workflow Preflight</small><h1>${escapeHtml(report.workflowName)}</h1><div class="score">${report.score}/100</div><p>${escapeHtml(report.summary)}</p><p>${report.nodeCount} nodes · ${report.connectionCount} connections · generated ${escapeHtml(report.generatedAt)}</p></header>${rows}<p><small>Deterministic structural analysis only. This report does not execute the workflow, access credentials, or guarantee production behavior.</small></p></body></html>`;
}
