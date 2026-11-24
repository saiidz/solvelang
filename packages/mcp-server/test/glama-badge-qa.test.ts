import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

// QA for the Glama badge (root: docs/mcp-server README badge line): pin the
// badge the awesome-mcp-servers maintainer asked for on
// punkpeye/awesome-mcp-servers#20177. The badge image is the maintainer's
// score.svg; the link target is the live Glama connector page (the
// /mcp/servers/ page 404s and must never be the link target). The badge sits
// on its own line directly under the existing mcptry badge below the H1.

function resolveFromHere(...urls: string[]): URL {
  for (const url of urls) {
    const candidate = new URL(url, import.meta.url);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return new URL(urls[0], import.meta.url);
}

const MCPTRY_BADGE =
  "[![mcptry](https://mcptry.com/badge/io.github.saiidz/solvelang)](https://mcptry.com/servers/io.github.saiidz/solvelang)";
const GLAMA_BADGE =
  "[![saiidz/solvelang MCP server](https://glama.ai/mcp/servers/saiidz/solvelang/badges/score.svg)](https://glama.ai/mcp/connectors/io.github.saiidz/solvelang)";

test("package README carries the Glama badge directly under the mcptry badge", async () => {
  const readme = await readFile(resolveFromHere("../../README.md", "../README.md"), "utf8");
  const lines = readme.split("\n");
  const mcptryIndex = lines.indexOf(MCPTRY_BADGE);
  assert.ok(mcptryIndex >= 0, "README still carries the mcptry badge under the H1");
  assert.equal(
    lines[mcptryIndex + 1],
    GLAMA_BADGE,
    "the Glama badge line sits immediately after the mcptry badge line",
  );
  assert.ok(
    !readme.includes("](https://glama.ai/mcp/servers/saiidz/solvelang)"),
    "the badge must link to the live connector page, never the 404 /mcp/servers/ page",
  );
});
