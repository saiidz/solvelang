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
  await mkdir(workspaceRoot);
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
  assert.notEqual(result.isError, true, "plugin MCP tool call must complete without a protocol/tool error");
  const text = result.content?.find((item) => item.type === "text")?.text;
  assert.equal(typeof text, "string", "plugin MCP tool call must return bounded text content");
  assert.match(text, /plugin-roundtrip/, "plugin MCP roundtrip must analyze the supplied in-memory workflow");
  assert.doesNotMatch(text, /PRIVATE KEY|github_pat_|gh[pousr]_/i, "plugin MCP roundtrip must not emit credential-like material");

  console.log(`SolveLang Codex/Claude plugin MCP roundtrip PASS at ${packageManifest.name}@${packageManifest.version}`);
} finally {
  if (client) {
    await client.close().catch(() => undefined);
  }
  if (previousWorkspaceRoot === undefined) delete process.env.SOLVELANG_WORKSPACE_ROOT;
  else process.env.SOLVELANG_WORKSPACE_ROOT = previousWorkspaceRoot;
  await rm(temporaryRoot, { recursive: true, force: true });
}
