import assert from "node:assert/strict";
import test from "node:test";
import { analyzeN8nWorkflow, createHtmlReport, parseN8nWorkflow } from "./n8nPreflight";

const validWorkflow = {
  name: "Lead routing",
  nodes: [
    { id: "1", name: "Webhook", type: "n8n-nodes-base.webhook" },
    { id: "2", name: "Route", type: "n8n-nodes-base.if" },
    { id: "3", name: "Create task", type: "n8n-nodes-base.httpRequest", credentials: { httpHeaderAuth: { id: "credential-id", name: "CRM" } } },
    { id: "4", name: "Stop on error", type: "n8n-nodes-base.stopAndError" },
  ],
  connections: {
    Webhook: { main: [[{ node: "Route" }]] },
    Route: { main: [[{ node: "Create task" }], [{ node: "Stop on error" }]] },
  },
};

test("parses a bounded n8n workflow and produces deterministic report fields", () => {
  const workflow = parseN8nWorkflow(validWorkflow);
  const report = analyzeN8nWorkflow(workflow, new Date("2026-07-16T12:00:00.000Z"));
  assert.equal(report.workflowName, "Lead routing");
  assert.equal(report.nodeCount, 4);
  assert.equal(report.connectionCount, 3);
  assert.equal(report.generatedAt, "2026-07-16T12:00:00.000Z");
  assert.ok(report.score >= 0 && report.score <= 100);
  assert.ok(report.findings.every((finding) => finding.id.startsWith("N8N")));
});

test("rejects non-n8n files, empty workflows, and oversized graphs", () => {
  assert.throws(() => parseN8nWorkflow(null), /JSON object/);
  assert.throws(() => parseN8nWorkflow({}), /nodes/);
  assert.throws(() => parseN8nWorkflow({ nodes: [] }), /no nodes/);
  assert.throws(() => parseN8nWorkflow({ nodes: Array.from({ length: 5001 }, () => ({})) }), /5,000-node/);
});

test("finds missing trigger, connections, risky code, and AI without review", () => {
  const workflow = parseN8nWorkflow({
    name: "Unsafe draft",
    nodes: [
      { name: "Custom code", type: "n8n-nodes-base.code" },
      { name: "AI Agent", type: "@n8n/n8n-nodes-langchain.agent" },
    ],
    connections: {},
  });
  const report = analyzeN8nWorkflow(workflow);
  const ids = new Set(report.findings.map((finding) => finding.id));
  assert.ok(ids.has("N8N001"));
  assert.ok(ids.has("N8N002"));
  assert.ok(ids.has("N8N005"));
  assert.ok(ids.has("N8N006"));
  assert.ok(report.severityCounts.critical >= 2);
});

test("generated HTML escapes workflow and finding text", () => {
  const workflow = parseN8nWorkflow({
    name: '<img src=x onerror="alert(1)">',
    nodes: [{ name: "Webhook", type: "webhook" }],
    connections: {},
  });
  const report = analyzeN8nWorkflow(workflow);
  const html = createHtmlReport(report);
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes('<img src=x onerror="alert(1)">'));
  assert.ok(html.includes("Deterministic structural analysis only"));
});

test("credential references are reported without serializing credential values into details", () => {
  const workflow = parseN8nWorkflow(validWorkflow);
  const report = analyzeN8nWorkflow(workflow);
  const credentialFinding = report.findings.find((finding) => finding.id === "N8N008");
  assert.ok(credentialFinding);
  assert.ok(!JSON.stringify(credentialFinding).includes("credential-id"));
});
