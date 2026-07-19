import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeN8nText } from "../src/n8n.js";
import { readWorkspaceText, resolveWorkspacePath } from "../src/workspace.js";

test("finds missing trigger and missing error path", () => {
  const report = analyzeN8nText(JSON.stringify({
    name: "Unsafe API",
    nodes: [{ name: "Call API", type: "n8n-nodes-base.httpRequest" }],
    connections: {},
  }));
  const ids = new Set(report.findings.map((finding) => finding.id));
  assert.ok(ids.has("N8N001"));
  assert.ok(ids.has("N8N007"));
});

test("disabled safeguards do not satisfy required gates", () => {
  const report = analyzeN8nText(JSON.stringify({
    nodes: [
      { name: "Webhook", type: "n8n-nodes-base.webhook", disabled: true },
      { name: "AI", type: "@n8n/n8n-nodes-langchain.agent" },
      { name: "Approval", type: "n8n-nodes-base.approval", disabled: true },
    ],
    connections: {},
  }));
  const ids = new Set(report.findings.map((finding) => finding.id));
  assert.ok(ids.has("N8N001"));
  assert.ok(ids.has("N8N006"));
  assert.ok(ids.has("N8N004"));
});

test("workspace paths cannot escape the configured root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "solvelang-mcp-"));
  process.env.SOLVELANG_WORKSPACE_ROOT = root;
  assert.throws(() => resolveWorkspacePath("../outside.json"), /outside/);
  await writeFile(path.join(root, "workflow.json"), JSON.stringify({ nodes: [{}] }));
  const result = await readWorkspaceText("workflow.json");
  assert.match(result.text, /nodes/);
});
