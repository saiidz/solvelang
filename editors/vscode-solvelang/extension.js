const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");
const { CONTEXT_PACK_TIMEOUT_MS, McpStdioClient, toolResultJson } = require("./mcp-client");

const execFileAsync = promisify(execFile);
let client;

function setting(name) {
  return vscode.workspace.getConfiguration("solvelang").get(name);
}

function activeSolveDocument() {
  const document = vscode.window.activeTextEditor?.document;
  return document?.languageId === "solvelang" ? document : undefined;
}

async function startLanguageServer() {
  if (!setting("languageServer.enabled")) {
    vscode.window.showInformationMessage("SolveLang language server is disabled. Set solvelang.languageServer.enabled to true to start a local solvelsp process.");
    return;
  }
  if (client) return;
  const command = setting("languageServer.command");
  const args = setting("languageServer.args");
  client = new LanguageClient("solvelang", "SolveLang Language Server", {
    command,
    args,
    transport: TransportKind.stdio,
  }, {
    documentSelector: [{ language: "solvelang" }],
  });
  await client.start();
}

async function formatDocument() {
  const document = activeSolveDocument();
  if (!document) return;
  if (!setting("formatter.enabled")) {
    vscode.window.showInformationMessage("SolveLang formatting is disabled. Set solvelang.formatter.enabled to true to permit local solvec fmt.");
    return;
  }
  if (document.isUntitled || document.isDirty) {
    vscode.window.showWarningMessage("Save the .solve document before running solvec fmt.");
    return;
  }
  const command = setting("formatter.command");
  try {
    await execFileAsync(command, ["fmt", document.uri.fsPath], { windowsHide: true });
    await vscode.commands.executeCommand("workbench.action.files.revert");
  } catch {
    vscode.window.showErrorMessage("SolveLang formatting failed. Check the configured solvec command.");
  }
}


let mcpClient;
let mcpOutput;

function mcpChannel() {
  if (!mcpOutput) mcpOutput = vscode.window.createOutputChannel("SolveLang MCP");
  return mcpOutput;
}

function workspaceRootPath() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function ensureMcpClient() {
  if (!setting("mcp.enabled")) {
    vscode.window.showInformationMessage("SolveLang MCP features are disabled. Set solvelang.mcp.enabled to true to start a local SolveLang MCP server process.");
    return undefined;
  }
  if (mcpClient?.running) return mcpClient;
  const root = workspaceRootPath();
  mcpClient = new McpStdioClient(setting("mcp.command"), setting("mcp.args"), {
    cwd: root,
    env: { ...process.env, ...(root ? { SOLVELANG_WORKSPACE_ROOT: root } : {}) },
    clientInfo: { name: "solvelang-vscode", version: "0.1.0" },
  });
  try {
    await mcpClient.start();
  } catch (error) {
    mcpChannel().appendLine(`Failed to start the SolveLang MCP server: ${error instanceof Error ? error.message : String(error)}`);
    mcpClient = undefined;
    vscode.window.showErrorMessage("SolveLang MCP server failed to start. See the SolveLang MCP output channel for details.");
    return undefined;
  }
  return mcpClient;
}

async function mcpListTools() {
  const client = await ensureMcpClient();
  if (!client) return;
  const tools = await client.listTools();
  const channel = mcpChannel();
  channel.clear();
  channel.appendLine(`SolveLang MCP tools (${tools.length}) from the local read-only server:`);
  for (const tool of tools) {
    channel.appendLine(`- ${tool.name} - ${tool.title ?? tool.description ?? ""}`);
  }
  channel.show(true);
}

async function buildContextPack() {
  const client = await ensureMcpClient();
  if (!client) return undefined;
  const task = await vscode.window.showInputBox({
    prompt: "Task the context pack should serve",
    placeHolder: "Assess the impact of changing src/store.ts",
  });
  if (!task) return undefined;
  const result = await client.callTool("solvelang_context_pack", { task }, CONTEXT_PACK_TIMEOUT_MS);
  const pack = toolResultJson(result);
  if (!pack) {
    vscode.window.showErrorMessage("SolveLang context pack did not return a JSON pack.");
    return undefined;
  }
  return pack;
}

async function mcpCreateContextPack() {
  const pack = await buildContextPack();
  if (!pack) return;
  const document = await vscode.workspace.openTextDocument({
    language: "json",
    content: `${JSON.stringify(pack, null, 2)}\n`,
  });
  await vscode.window.showTextDocument(document);
}

async function mcpInspectContextPack() {
  const pack = await buildContextPack();
  if (!pack) return;
  const inner = pack.pack ?? pack;
  const entries = Array.isArray(inner.entries) ? inner.entries : [];
  const channel = mcpChannel();
  channel.clear();
  channel.appendLine(`Context pack: ${inner.id ?? pack.id ?? "(no id)"}`);
  channel.appendLine(`Schema: ${pack.schema ?? inner.schema ?? "(unknown)"}`);
  channel.appendLine(`Entries: ${entries.length}`);
  for (const entry of entries) {
    channel.appendLine(`- ${entry.path} lines ${entry.startLine}-${entry.endLine} (${entry.bytes} bytes, source sha256 ${String(entry.sourceSha256 ?? "").slice(0, 12)})`);
  }
  channel.show(true);
}

async function mcpStopServer() {
  await mcpClient?.stop();
  mcpClient = undefined;
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("solvelang.startLanguageServer", startLanguageServer),
    vscode.commands.registerCommand("solvelang.stopLanguageServer", async () => {
      await client?.stop();
      client = undefined;
    }),
    vscode.commands.registerCommand("solvelang.formatDocument", formatDocument),
    vscode.commands.registerCommand("solvelang.mcpListTools", mcpListTools),
    vscode.commands.registerCommand("solvelang.mcpCreateContextPack", mcpCreateContextPack),
    vscode.commands.registerCommand("solvelang.mcpInspectContextPack", mcpInspectContextPack),
    vscode.commands.registerCommand("solvelang.mcpStopServer", mcpStopServer),
  );
}

async function deactivate() {
  await client?.stop();
  client = undefined;
  await mcpClient?.stop();
  mcpClient = undefined;
}

module.exports = { activate, deactivate };
