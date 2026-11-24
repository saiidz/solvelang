import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Step 1 follow-up (QA): pin the legacy plugin example configs to the same
// working npx form as the shipped shared config (plugins/solvelang/.mcp.json,
// pinned by plugin-mcp-config.test.ts). The published
// @solvelang/mcp-server@0.3.0 package ships two executables, so the bare
// `npx --yes @solvelang/mcp-server` form these legacy examples carried cannot
// choose one and fails ("could not determine executable to run"). Both
// examples must carry the explicit --package form, pinned here exactly.

const PINNED_ARGS = [
  "-y",
  "--package",
  "@solvelang/mcp-server@0.3.0",
  "solvelang-mcp",
];

function repoFileUrl(rel: string): URL {
  const candidates = [
    new URL(`../../../../${rel}`, import.meta.url),
    new URL(`../../../${rel}`, import.meta.url),
  ];
  for (const candidate of candidates) {
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return candidates[0];
}

test("claude plugin example (.mcp.json.example) pins the explicit --package npx form", async () => {
  const raw = await readFile(repoFileUrl("plugins/claude/.mcp.json.example"), "utf8");
  const manifest = JSON.parse(raw) as {
    mcpServers: {
      solvelang: { command: string; args: string[]; env: Record<string, string> };
    };
  };
  assert.equal(manifest.mcpServers.solvelang.command, "npx");
  assert.deepEqual(manifest.mcpServers.solvelang.args, PINNED_ARGS);
  const rendered = `npx ${manifest.mcpServers.solvelang.args.join(" ")}`;
  assert.equal(rendered, "npx -y --package @solvelang/mcp-server@0.3.0 solvelang-mcp");
  assert.equal(
    manifest.mcpServers.solvelang.env.SOLVELANG_WORKSPACE_ROOT,
    "/absolute/path/to/workspace",
  );
  assert.ok(!raw.includes('"--yes"'), "the failing bare-package args must not return");
});

test("codex plugin example (config.toml.example) pins the explicit --package npx form", async () => {
  const raw = await readFile(repoFileUrl("plugins/codex/config.toml.example"), "utf8");
  assert.ok(raw.includes('command = "npx"'), "the example must keep the npx command");
  assert.ok(
    raw.includes('args = ["-y", "--package", "@solvelang/mcp-server@0.3.0", "solvelang-mcp"]'),
    "the example must carry the explicit --package args verbatim",
  );
  assert.ok(
    !raw.includes('args = ["--yes", "@solvelang/mcp-server"]'),
    "the failing bare-package args must not return",
  );
  assert.ok(
    raw.includes('SOLVELANG_WORKSPACE_ROOT = "/absolute/path/to/workspace"'),
    "the example env block must stay intact",
  );
});
