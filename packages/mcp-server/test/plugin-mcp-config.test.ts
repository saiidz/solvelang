import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Step 1 G3 (QA): pin the shared plugin MCP configuration verbatim.
// plugins/solvelang/.mcp.json is the configuration both the Claude Code and
// Codex plugins execute. The published @solvelang/mcp-server@0.3.0 package
// ships two executables, so the bare `npx --yes @solvelang/mcp-server@0.3.0`
// form cannot choose one and fails ("could not determine executable to run").
// The config must carry the explicit --package form, pinned here exactly.

function pluginConfigUrl(): URL {
  const candidates = [
    new URL("../../../../plugins/solvelang/.mcp.json", import.meta.url),
    new URL("../../../plugins/solvelang/.mcp.json", import.meta.url),
  ];
  for (const candidate of candidates) {
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return candidates[0];
}

test("plugin .mcp.json pins the explicit --package npx form verbatim", async () => {
  const raw = await readFile(pluginConfigUrl(), "utf8");
  const manifest = JSON.parse(raw) as {
    mcpServers: { solvelang: { command: string; args: string[] } };
  };
  assert.equal(manifest.mcpServers.solvelang.command, "npx");
  assert.deepEqual(manifest.mcpServers.solvelang.args, [
    "-y",
    "--package",
    "@solvelang/mcp-server@0.3.0",
    "solvelang-mcp",
  ]);
  const rendered = `npx ${manifest.mcpServers.solvelang.args.join(" ")}`;
  assert.equal(rendered, "npx -y --package @solvelang/mcp-server@0.3.0 solvelang-mcp");
  assert.ok(!raw.includes('"--yes"'), "the failing bare-package args must not return");
  assert.ok(
    !raw.includes("solvelang-mcp-remote"),
    "the plugin config starts the local server, not the remote entrypoint",
  );
  assert.equal(path.basename(fileURLToPath(pluginConfigUrl())), ".mcp.json");
});
