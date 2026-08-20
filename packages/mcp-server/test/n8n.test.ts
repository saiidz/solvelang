import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeN8nText, MAX_N8N_BYTES, MAX_N8N_NODES } from "../src/n8n.js";
import { readWorkspaceText, resolveWorkspaceFilePath, resolveWorkspacePath } from "../src/workspace.js";

type ParityCase = { name: string; workflow: unknown; expectedIds: string[]; score: number };
type InvalidParityCase = { name: string; workflow: unknown };

test("finds missing trigger and missing error path", () => {
  const report = analyzeN8nText(JSON.stringify({
    name: "Unsafe API",
    nodes: [{ name: "Call API", type: "n8n-nodes-base.httpRequest" }],
    connections: {},
  }));
  const ids = new Set(report.findings.map((finding) => finding.id));
  assert.ok(ids.has("N8N001"));
  assert.ok(ids.has("N8N007"));
  assert.equal(report.pass, false);
  assert.equal(report.schema, "solvelang.mcp.n8n-preflight.v2");
  assert.equal(report.severityCounts.critical, 1);
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

test("raw JSON analysis is deterministic and contains evidence", () => {
  const raw = JSON.stringify({
    name: "Deterministic",
    nodes: [
      { name: "Webhook", type: "n8n-nodes-base.webhook" },
      { name: "Code", type: "n8n-nodes-base.code" },
    ],
    connections: {},
  });
  const first = analyzeN8nText(raw);
  const second = analyzeN8nText(raw);
  assert.deepEqual(first, second);
  assert.ok(first.findings.every((finding) => finding.evidence.length > 0));
  assert.deepEqual(first.findings.map((finding) => finding.id), [...first.findings.map((finding) => finding.id)].sort());
});

test("malformed raw JSON is rejected without echoing input", () => {
  const secret = "super-secret-value";
  assert.throws(() => analyzeN8nText(`{\"nodes\":[${secret}]`), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "The workflow is not valid JSON.");
    assert.doesNotMatch(error.message, /super-secret-value/);
    return true;
  });
});

test("oversized raw JSON is rejected before parsing", () => {
  const oversized = "x".repeat(MAX_N8N_BYTES + 1);
  assert.throws(() => analyzeN8nText(oversized), /2 MB safety limit/);
});

test("node count is bounded", () => {
  const nodes = Array.from({ length: MAX_N8N_NODES + 1 }, () => ({}));
  assert.throws(() => analyzeN8nText(JSON.stringify({ nodes })), /5,000-node safety limit/);
});

test("workspace paths cannot escape the configured root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "solvelang-mcp-"));
  process.env.SOLVELANG_WORKSPACE_ROOT = root;
  assert.throws(() => resolveWorkspacePath("../outside.json"), /outside/);
  await writeFile(path.join(root, "workflow.json"), JSON.stringify({ nodes: [{}] }));
  const result = await readWorkspaceText("workflow.json");
  assert.match(result.text, /nodes/);
});

test("workspace file readers reject symbolic links", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "solvelang-mcp-"));
  const outside = path.join(os.tmpdir(), `solvelang-mcp-secret-${Date.now()}.json`);
  process.env.SOLVELANG_WORKSPACE_ROOT = root;
  await writeFile(outside, JSON.stringify({ secret: "outside" }));
  await symlink(outside, path.join(root, "workflow.json"));
  await assert.rejects(() => resolveWorkspaceFilePath("workflow.json"), /symbolic link/);
  await assert.rejects(() => readWorkspaceText("workflow.json"), /symbolic link/);
});

test("MCP preflight matches the shared parity fixtures", async () => {
  const cases = JSON.parse(await readFile("../../fixtures/n8n-preflight-parity/cases.json", "utf8")) as ParityCase[];
  for (const fixture of cases) {
    const report = analyzeN8nText(JSON.stringify(fixture.workflow));
    assert.deepEqual(report.findings.map(({ id }) => id), fixture.expectedIds, fixture.name);
    assert.equal(report.score, fixture.score, fixture.name);
  }
});

test("MCP preflight rejects every shared invalid parity fixture", async () => {
  const cases = JSON.parse(await readFile("../../fixtures/n8n-preflight-parity/invalid-cases.json", "utf8")) as InvalidParityCase[];
  for (const fixture of cases) assert.throws(() => analyzeN8nText(JSON.stringify(fixture.workflow)), { name: "Error" }, fixture.name);
});
