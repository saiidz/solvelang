import type { WorkflowAnalysis, WorkflowAnalytics, WorkflowDocument } from "./types";

export function serializeWorkflow(workflow: WorkflowDocument) { return JSON.stringify(workflow, null, 2); }
export function serializeFindings(analysis: WorkflowAnalysis) { return JSON.stringify(analysis.findings, null, 2); }
export function serializeAnalytics(analytics: WorkflowAnalytics) { return JSON.stringify(analytics, null, 2); }
export function serializeTraces(traces: unknown[]) { return JSON.stringify(traces, null, 2); }

function flatten(prefix: string, value: unknown, rows: Array<[string, string]>) {
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") rows.push([prefix, String(value)]);
  else if (Array.isArray(value)) rows.push([prefix, value.join(" | ")]);
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) flatten(prefix ? `${prefix}.${key}` : key, child, rows);
}

export function exportAnalyticsCsv(analytics: WorkflowAnalytics) {
  const rows: Array<[string, string]> = [];
  flatten("", analytics, rows);
  return ["metric,value", ...rows.map(([metric, value]) => `"${metric.replaceAll('"', '""')}","${value.replaceAll('"', '""')}"`)].join("\n");
}

export function exportMarkdownReport(workflow: WorkflowDocument, analysis: WorkflowAnalysis, analytics: WorkflowAnalytics) {
  return `# Workflow X-Ray: ${workflow.name}\n\nGenerated locally by SolveLang Workflow Intelligence Studio.\n\n## Summary\n\n- Automation readiness: ${analysis.score.value}/100\n- Nodes: ${workflow.nodes.length}\n- Edges: ${workflow.edges.length}\n- Open findings: ${analysis.findings.filter((item) => !item.suppressed).length}\n- Scenario pass rate: ${analytics.scenario.scenarioPassRate}%\n\n## Findings\n\n${analysis.findings.map((item) => `- **${item.ruleId} ${item.title}** — ${item.explanation} ${item.remediation}`).join("\n") || "No findings."}\n\n## Human review\n\n${workflow.nodes.filter((node) => node.humanRequired || node.type === "human_review" || node.type === "approval").map((node) => `- ${node.title} (${node.owner || "owner missing"})`).join("\n") || "No human-review nodes modeled."}\n`;
}

export function exportPrintableHtml(workflow: WorkflowDocument, analysis: WorkflowAnalysis, analytics: WorkflowAnalytics) {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(workflow.name)} Workflow X-Ray</title><style>body{font:16px/1.5 system-ui;margin:40px;color:#10233f}h1,h2{line-height:1.15}.metric{display:inline-block;margin:0 24px 16px 0}.finding{border-top:1px solid #ccd5e0;padding:12px 0}@media print{body{margin:20mm}}</style></head><body><h1>${escape(workflow.name)}</h1><p>Local deterministic Workflow X-Ray report.</p><div class="metric"><strong>${analysis.score.value}</strong><br>Readiness</div><div class="metric"><strong>${analytics.scenario.scenarioPassRate}%</strong><br>Scenario pass rate</div><h2>Findings</h2>${analysis.findings.map((item) => `<div class="finding"><strong>${item.ruleId} ${escape(item.title)}</strong><p>${escape(item.explanation)}</p></div>`).join("") || "<p>No findings.</p>"}</body></html>`;
}

export function generateSolveLangDraft(workflow: WorkflowDocument) {
  const lines = ["// GENERATED DRAFT — REVIEW BEFORE RUNNING", "// Studio-only concepts are preserved as comments and may not be executable.", `// Workflow: ${workflow.name}`, ""];
  for (const policy of workflow.policies) lines.push(`// policy ${policy.id}: ${policy.title}`);
  if (workflow.policies.length) lines.push("");
  for (const node of workflow.nodes) {
    lines.push(`// [${node.type}] ${node.title}`);
    if (node.owner) lines.push(`// owner: ${node.owner}`);
    if (node.policyRefs.length) lines.push(`// policy references: ${node.policyRefs.join(", ")}`);
    if (node.humanRequired || node.type === "human_review" || node.type === "approval") lines.push("// human review required before continuing");
    if (node.type === "trigger") lines.push(`print("Workflow started: ${node.title.replaceAll('"', '\\"')}")`);
    else if (node.type === "terminal") lines.push(`print("Terminal: ${node.title.replaceAll('"', '\\"')}")`);
    else lines.push(`// Studio-only step: ${node.type}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function downloadText(filename: string, content: string, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

export async function copyText(content: string) { await navigator.clipboard.writeText(content); }
