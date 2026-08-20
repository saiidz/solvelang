const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

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
  const args = setting("formatter.args");
  try {
    await execFileAsync(command, [...args, document.uri.fsPath], { windowsHide: true });
    await vscode.commands.executeCommand("workbench.action.files.revert");
  } catch {
    vscode.window.showErrorMessage("SolveLang formatting failed. Check the configured solvec command and formatter arguments.");
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("solvelang.startLanguageServer", startLanguageServer),
    vscode.commands.registerCommand("solvelang.stopLanguageServer", async () => {
      await client?.stop();
      client = undefined;
    }),
    vscode.commands.registerCommand("solvelang.formatDocument", formatDocument),
  );
}

async function deactivate() {
  await client?.stop();
  client = undefined;
}

module.exports = { activate, deactivate };
