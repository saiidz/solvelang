import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerContextTools } from "../src/context-tools.js";

interface Registration {
  definition: {
    inputSchema: { parse(input: unknown): unknown };
    annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean };
  };
  handler: (input: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

function registeredTools(): Map<string, Registration> {
  const registrations = new Map<string, Registration>();
  const capture = {
    registerTool(name: string, definition: Registration["definition"], handler: Registration["handler"]) {
      registrations.set(name, { definition, handler });
      return {};
    },
  };
  registerContextTools(capture as unknown as McpServer);
  return registrations;
}

test("shared Claude/Codex handlers forward changed paths and preserve read-only authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "solve-context-tool-"));
  const previous = process.env.SOLVELANG_WORKSPACE_ROOT;
  process.env.SOLVELANG_WORKSPACE_ROOT = root;
  try {
    await writeFile(path.join(root, "entry.ts"), "export const value = 17;\n");
    const registrations = registeredTools();
    for (const name of ["solvelang_context_plan", "solvelang_context_pack"]) {
      const { definition, handler } = registrations.get(name)!;
      assert.equal(definition.annotations.readOnlyHint, true);
      assert.equal(definition.annotations.destructiveHint, false);
      assert.equal(definition.annotations.openWorldHint, false);
      const input = definition.inputSchema.parse({ task: "rare_task_marker", paths: ["entry.ts"], changedPaths: ["entry.ts"] });
      const result = JSON.parse((await handler(input)).content[0].text);
      assert.deepEqual(result.pack.entries.map((entry: { path: string }) => entry.path), ["entry.ts"]);
      assert.equal("content" in result.pack.entries[0], name === "solvelang_context_pack");
      assert.deepEqual(result.workspace.selection.changedPaths, ["entry.ts"]);
      await assert.rejects(() => handler(definition.inputSchema.parse({
        task: "rare_task_marker", paths: ["entry.ts"], changedPaths: ["entry.ts"], graphPath: "missing-graph.json",
      })), /ENOENT/); // A graph request must not be silently dropped by MCP argument wiring.
    }
  } finally {
    if (previous === undefined) delete process.env.SOLVELANG_WORKSPACE_ROOT;
    else process.env.SOLVELANG_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("both public context input schemas enforce changed-path bounds", () => {
  const registrations = registeredTools();
  for (const name of ["solvelang_context_plan", "solvelang_context_pack"]) {
    const schema = registrations.get(name)!.definition.inputSchema;
    assert.throws(() => schema.parse({ task: "task", changedPaths: [] }));
    assert.throws(() => schema.parse({ task: "task", changedPaths: Array(129).fill("entry.ts") }));
    assert.throws(() => schema.parse({ task: "task", changedPaths: ["entry.ts"], graphPath: "x".repeat(4_097) }));
  }
});
