import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

test("MCP features stay opt-in and inert until enabled", async () => {
  const manifest = await json("package.json");
  const settings = manifest.contributes.configuration.properties;
  assert.equal(settings["solvelang.mcp.enabled"].default, false);
  assert.equal(settings["solvelang.mcp.command"].default, "solvelang-mcp");
  assert.deepEqual(settings["solvelang.mcp.args"].default, []);

  const extension = await readFile(path.join(root, "extension.js"), "utf8");
  assert.match(extension, /mcp\.enabled/);
  assert.match(extension, /SOLVELANG_WORKSPACE_ROOT/);
});

test("registers the four MCP commands in the manifest and the extension", async () => {
  const manifest = await json("package.json");
  const contributed = manifest.contributes.commands.map((item) => item.command);
  for (const command of [
    "solvelang.mcpListTools",
    "solvelang.mcpCreateContextPack",
    "solvelang.mcpInspectContextPack",
    "solvelang.mcpStopServer",
  ]) {
    assert.ok(contributed.includes(command), `manifest must contribute ${command}`);
    assert.ok(manifest.activationEvents.includes(`onCommand:${command}`), `manifest must activate on ${command}`);
  }

  const extension = await readFile(path.join(root, "extension.js"), "utf8");
  for (const command of [
    "solvelang.mcpListTools",
    "solvelang.mcpCreateContextPack",
    "solvelang.mcpInspectContextPack",
    "solvelang.mcpStopServer",
  ]) {
    assert.match(extension, new RegExp(`registerCommand\\("${command.replace(".", "\\.")}"`));
  }
  assert.match(extension, /solvelang_context_pack/);
});

test("the MCP client is stdio-only and dependency-free", async () => {
  const client = await readFile(path.join(root, "mcp-client.js"), "utf8");
  assert.match(client, /node:child_process/);
  assert.doesNotMatch(client, /node:http|node:https|node:net|fetch\(|XMLHttpRequest/);
  assert.doesNotMatch(client, /require\("(?!node:)/);
  assert.match(client, /notifications\/initialized/);
});
