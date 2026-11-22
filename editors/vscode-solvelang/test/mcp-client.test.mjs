import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { McpStdioClient, toolResultJson } = require("../mcp-client.js");

const FAKE_SERVER = `
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const index = buffer.indexOf("\\n");
    if (index < 0) return;
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      respond(message.id, { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fake-mcp", version: "0.0.0" } });
    } else if (message.method === "tools/list") {
      respond(message.id, { tools: [{ name: "fake_echo", description: "echo tool" }] });
    } else if (message.method === "tools/call") {
      if (message.params?.name === "fake_fail") {
        respondError(message.id, -32601, "tool not found");
      } else {
        respond(message.id, { content: [{ type: "text", text: JSON.stringify({ echo: message.params?.arguments ?? {} }) }] });
      }
    }
  }
});
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\\n");
}
`;

test("McpStdioClient completes the handshake, lists tools, and calls tools", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "solvelang-fake-mcp-"));
  const script = path.join(dir, "fake-mcp-server.mjs");
  await writeFile(script, FAKE_SERVER, "utf8");
  const client = new McpStdioClient(process.execPath, [script], {});
  try {
    await client.start();
    assert.equal(client.running, true);
    const tools = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ["fake_echo"]);
    const echoed = toolResultJson(await client.callTool("fake_echo", { hello: "world" }));
    assert.deepEqual(echoed, { echo: { hello: "world" } });
    await assert.rejects(() => client.callTool("fake_fail", {}), /tool not found/);
  } finally {
    await client.stop();
    await rm(dir, { recursive: true, force: true });
  }
  assert.equal(client.running, false);
});

// Headless smoke against the REAL local SolveLang MCP server. Runs only
// when SOLVELANG_MCP_SERVER_ENTRY points at a built dist/src/index.js
// (the vscode-extension CI workflow sets it); skipped otherwise.
const serverEntry = process.env.SOLVELANG_MCP_SERVER_ENTRY;
test(
  "extension MCP client drives the real local SolveLang MCP server",
  { skip: serverEntry ? false : "SOLVELANG_MCP_SERVER_ENTRY is not set" },
  async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "solvelang-ext-smoke-"));
    await writeFile(
      path.join(workspace, "store.ts"),
      "export const store = { value: 1 };\n// src/store.ts holds the shared store.\n",
      "utf8",
    );
    await writeFile(
      path.join(workspace, "api.ts"),
      "import { store } from \"./store\";\nexport const api = () => store.value;\n",
      "utf8",
    );
    const client = new McpStdioClient(process.execPath, [serverEntry], {
      cwd: workspace,
      env: { ...process.env, SOLVELANG_WORKSPACE_ROOT: workspace },
    });
    try {
      await client.start();
      const tools = await client.listTools();
      const names = tools.map((tool) => tool.name);
      assert.ok(names.includes("solvelang_context_pack"), "local server must expose the context pack tool");
      assert.ok(names.includes("solvelang_context_plan"), "local server must expose the context plan tool");
      assert.ok(names.includes("solvelang_context_index_query"), "local server must expose the context index query tool");
      assert.ok(names.includes("solvelang_context_index_status"), "local server must expose the context index status tool");
      // Phase 0 verified the local read-only surface at 29 tools; Phase 7
      // added the two read-only Solve Context index tools (31 total). A
      // change in the count is a deliberate surface change and must update
      // this pin.
      assert.equal(tools.length, 31);
      const pack = toolResultJson(
        await client.callTool("solvelang_context_pack", { task: "Assess the impact of changing store.ts" }, 180_000),
      );
      assert.ok(pack, "context pack call must return a JSON pack");
      const entries = pack.pack?.entries ?? [];
      assert.ok(entries.length >= 1, "context pack must select at least one excerpt");
      assert.ok(entries.every((entry) => /^[a-f0-9]{64}$/.test(entry.sourceSha256)));
    } finally {
      await client.stop();
      await rm(workspace, { recursive: true, force: true });
    }
  },
);
