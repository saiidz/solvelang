import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageRoot, "../..");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function toolText(result, label) {
  assert.notEqual(result.isError, true, `${label} must complete without a protocol/tool error`);
  const text = result.content?.find((item) => item.type === "text")?.text;
  assert.equal(typeof text, "string", `${label} must return text content`);
  return text;
}

const packageManifest = await readJson(path.join(packageRoot, "package.json"));
const codexManifest = await readJson(path.join(repositoryRoot, "plugins", "solvelang", ".codex-plugin", "plugin.json"));
const claudeManifest = await readJson(path.join(repositoryRoot, "plugins", "solvelang", ".claude-plugin", "plugin.json"));
const mcpManifest = await readJson(path.join(repositoryRoot, "plugins", "solvelang", ".mcp.json"));

for (const [label, manifest] of [["Codex", codexManifest], ["Claude", claudeManifest]]) {
  assert.equal(manifest.name, "solvelang", `${label} plugin name drifted`);
  assert.equal(manifest.version, packageManifest.version, `${label} plugin version drifted from the MCP package`);
  assert.equal(manifest.mcpServers, "./.mcp.json", `${label} plugin must use the canonical shared MCP configuration`);
}

assert.deepEqual(mcpManifest, {
  mcpServers: {
    solvelang: {
      command: "npx",
      args: ["--yes", `@solvelang/mcp-server@${packageManifest.version}`],
    },
  },
}, "Codex and Claude must resolve the same pinned SolveLang MCP package");

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "solvelang-plugin-roundtrip-"));
let client;
const previousWorkspaceRoot = process.env.SOLVELANG_WORKSPACE_ROOT;
try {
  const npmEnvironment = { ...process.env, npm_config_cache: path.join(temporaryRoot, "npm-cache") };
  const { stdout } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", temporaryRoot], {
    cwd: packageRoot,
    env: npmEnvironment,
    maxBuffer: 10 * 1024 * 1024,
  });
  const [packResult] = JSON.parse(stdout);
  assert.ok(packResult?.filename, "npm pack must produce one reviewed MCP tarball");

  const consumerRoot = path.join(temporaryRoot, "consumer");
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  await mkdir(consumerRoot);
  await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "logs"), { recursive: true });
  const invoicePath = path.join(workspaceRoot, "src", "invoice.ts");
  const workerLog = `${"INFO queue unchanged\n".repeat(100)}ERROR payment failed code=E_TIMEOUT\n${"INFO queue unchanged\n".repeat(20)}`;
  await writeFile(invoicePath, "export function retryInvoice() {\n  return schedulePaymentRetry();\n}\n", "utf8");
  await writeFile(path.join(workspaceRoot, "logs", "worker.log"), workerLog, "utf8");
  await writeFile(path.join(consumerRoot, "package.json"), '{"private":true,"type":"module"}\n');

  const tarballPath = path.join(temporaryRoot, packResult.filename);
  await execFileAsync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], {
    cwd: consumerRoot,
    env: npmEnvironment,
    maxBuffer: 10 * 1024 * 1024,
  });

  const installedManifest = await readJson(path.join(
    consumerRoot,
    "node_modules",
    "@solvelang",
    "mcp-server",
    "package.json",
  ));
  assert.equal(installedManifest.name, packageManifest.name);
  assert.equal(installedManifest.version, packageManifest.version);

  const installedEntrypoint = path.join(
    consumerRoot,
    "node_modules",
    "@solvelang",
    "mcp-server",
    "dist",
    "src",
    "index.js",
  );

  process.env.SOLVELANG_WORKSPACE_ROOT = workspaceRoot;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [installedEntrypoint],
    cwd: workspaceRoot,
  });
  client = new Client(
    { name: "solvelang-plugin-roundtrip-smoke", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  const listed = await client.listTools();
  const tools = new Map(listed.tools.map((tool) => [tool.name, tool]));
  for (const requiredName of [
    "solvelang_analyze_n8n",
    "solvelang_generate_n8n_report",
    "solvelang_graph_find_nodes",
    "solvelang_graph_explain_impact",
    "solvelang_context_plan",
    "solvelang_context_pack",
    "solvelang_context_retrieve",
    "solvelang_context_handoff",
    "solvelang_context_handoff_validate",
    "solvelang_context_compact_structured",
    "solvelang_context_expand_rle",
    "solvelang_context_compaction_capabilities",
    "solvelang_context_capabilities",
  ]) {
    const tool = tools.get(requiredName);
    assert.ok(tool, `plugin MCP roundtrip is missing required tool ${requiredName}`);
    assert.equal(tool.annotations?.readOnlyHint, true, `${requiredName} must remain read-only`);
    assert.equal(tool.annotations?.destructiveHint, false, `${requiredName} must remain non-destructive`);
  }

  const fixture = JSON.stringify({
    name: "plugin-roundtrip",
    nodes: [
      {
        parameters: {},
        id: "plugin-roundtrip-trigger",
        name: "Manual Trigger",
        type: "n8n-nodes-base.manualTrigger",
        typeVersion: 1,
        position: [0, 0],
      },
    ],
    connections: {},
  });
  const result = await client.callTool({
    name: "solvelang_analyze_n8n",
    arguments: { rawJson: fixture },
  });
  const text = toolText(result, "plugin MCP n8n call");
  assert.match(text, /plugin-roundtrip/, "plugin MCP roundtrip must analyze the supplied in-memory workflow");
  assert.doesNotMatch(text, /PRIVATE KEY|github_pat_|gh[pousr]_/i, "plugin MCP roundtrip must not emit credential-like material");

  const planResult = await client.callTool({
    name: "solvelang_context_plan",
    arguments: { task: "fix invoice payment retry", paths: ["src/invoice.ts"], budgetBytes: 4_096 },
  });
  const plan = JSON.parse(toolText(planResult, "Solve Context plan"));
  assert.equal(plan.schema, "solvelang.context.plan.v0");
  assert.equal(plan.workspace.mode, "explicit");
  assert.equal(plan.pack.entries.length, 1);
  assert.equal("content" in plan.pack.entries[0], false, "context plan must not return source content");

  const contextPackResult = await client.callTool({
    name: "solvelang_context_pack",
    arguments: { task: "fix invoice payment retry", paths: ["src/invoice.ts"], budgetBytes: 4_096 },
  });
  const contextPack = JSON.parse(toolText(contextPackResult, "Solve Context pack"));
  assert.equal(contextPack.schema, "solvelang.context.workspace-pack.v0");
  assert.equal(contextPack.pack.entries.length, 1);
  const [entry] = contextPack.pack.entries;
  assert.match(entry.handle, /^ctx_[a-f0-9]{32}$/);
  assert.match(entry.content, /retryInvoice/);

  const contextReference = {
    handle: entry.handle,
    path: entry.path,
    startLine: entry.startLine,
    endLine: entry.endLine,
    sourceSha256: entry.sourceSha256,
    excerptSha256: entry.excerptSha256,
  };
  const retrievalResult = await client.callTool({
    name: "solvelang_context_retrieve",
    arguments: contextReference,
  });
  const retrieval = JSON.parse(toolText(retrievalResult, "Solve Context retrieval"));
  assert.equal(retrieval.schema, "solvelang.context.retrieval.v0");
  assert.equal(retrieval.content, entry.content, "retrieval must reproduce the exact packed excerpt");
  assert.equal(retrieval.handle, entry.handle);

  const logCompactionResult = await client.callTool({
    name: "solvelang_context_compact_structured",
    arguments: { kind: "log", path: "logs/worker.log" },
  });
  const logCompaction = JSON.parse(toolText(logCompactionResult, "Solve Context log compaction"));
  assert.equal(logCompaction.schema, "solvelang.context.compaction.v0");
  assert.equal(logCompaction.codec, "line-rle-v0");
  assert.equal(logCompaction.fidelity, "byte-exact");
  assert.equal(logCompaction.reversibleToOriginal, true);
  assert.equal(logCompaction.applied, true);
  assert.deepEqual(logCompaction.source, { mode: "workspace", path: "logs/worker.log" });
  assert.ok(logCompaction.reductionBytes > 0);
  assert.ok(logCompaction.payload.records.some((record) => record.segment === "ERROR payment failed code=E_TIMEOUT\n"));

  const expandedLogResult = await client.callTool({
    name: "solvelang_context_expand_rle",
    arguments: {
      kind: "log",
      sourceSha256: logCompaction.sourceSha256,
      sourceBytes: logCompaction.sourceBytes,
      candidateSha256: logCompaction.candidateSha256,
      candidateBytes: logCompaction.candidateBytes,
      records: logCompaction.payload.records,
    },
  });
  const expandedLog = JSON.parse(toolText(expandedLogResult, "Solve Context log expansion"));
  assert.equal(expandedLog.schema, "solvelang.context.expansion.v0");
  assert.equal(expandedLog.content, workerLog, "line RLE expansion must reproduce the exact log bytes");

  const jsonWithLargeNumber = `{\n  "large": 9007199254740993123456789,\n  "ratio": 1.2300e+09,\n  "message": "keep  spaces"\n}\n`;
  const jsonCompactionResult = await client.callTool({
    name: "solvelang_context_compact_structured",
    arguments: { kind: "json", rawText: jsonWithLargeNumber },
  });
  const jsonCompaction = JSON.parse(toolText(jsonCompactionResult, "Solve Context JSON compaction"));
  assert.equal(jsonCompaction.codec, "json-whitespace-v0");
  assert.equal(jsonCompaction.fidelity, "json-token-exact");
  assert.equal(jsonCompaction.applied, true);
  assert.equal(jsonCompaction.payload.content, `{"large":9007199254740993123456789,"ratio":1.2300e+09,"message":"keep  spaces"}`);

  const handoffResult = await client.callTool({
    name: "solvelang_context_handoff",
    arguments: {
      fromAgent: "claude",
      toAgent: "codex",
      goal: "Finish the invoice payment retry fix.",
      decisions: ["Keep retry state local to the invoice module."],
      unresolvedQuestions: ["Does the timeout path need an integration test?"],
      changedPaths: ["src/invoice.ts"],
      tests: [{ label: "invoice unit tests", status: "passed", evidence: "smoke fixture" }],
      context: [contextReference],
    },
  });
  const handoff = JSON.parse(toolText(handoffResult, "Solve Context handoff"));
  assert.equal(handoff.schema, "solvelang.context.handoff.v0");
  assert.equal(handoff.fromAgent, "claude");
  assert.equal(handoff.toAgent, "codex");
  assert.match(handoff.handoffId, /^sch_[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(handoff).includes("schedulePaymentRetry"), false, "handoff must transfer provenance instead of source bodies");

  const handoffValidationResult = await client.callTool({
    name: "solvelang_context_handoff_validate",
    arguments: { handoff },
  });
  const handoffValidation = JSON.parse(toolText(handoffValidationResult, "Solve Context handoff validation"));
  assert.equal(handoffValidation.schema, "solvelang.context.handoff-validation.v0");
  assert.equal(handoffValidation.valid, true);
  assert.equal(handoffValidation.integrityValid, true);
  assert.equal(handoffValidation.contentFresh, true);

  await writeFile(invoicePath, "export function retryInvoice() {\n  return schedulePaymentRetryWithBackoff();\n}\n", "utf8");
  const staleValidationResult = await client.callTool({
    name: "solvelang_context_handoff_validate",
    arguments: { handoff },
  });
  const staleValidation = JSON.parse(toolText(staleValidationResult, "stale Solve Context handoff validation"));
  assert.equal(staleValidation.integrityValid, true, "source drift must not change the transferred handoff checksum");
  assert.equal(staleValidation.contentFresh, false, "receiver must detect workspace drift after the handoff was created");
  assert.equal(staleValidation.valid, false);
  assert.ok(staleValidation.staleChangedSources.length >= 1);
  assert.ok(staleValidation.staleContextReferences.length >= 1);

  console.log(`SolveLang Codex/Claude plugin MCP roundtrip PASS at ${packageManifest.name}@${packageManifest.version}`);
} finally {
  if (client) {
    await client.close().catch(() => undefined);
  }
  if (previousWorkspaceRoot === undefined) delete process.env.SOLVELANG_WORKSPACE_ROOT;
  else process.env.SOLVELANG_WORKSPACE_ROOT = previousWorkspaceRoot;
  await rm(temporaryRoot, { recursive: true, force: true });
}
