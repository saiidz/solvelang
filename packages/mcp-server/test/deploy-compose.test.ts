import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("hosted MCP deploy shape keeps the cpu_shares latency guard", () => {
  const compose = readFileSync(path.join(packageRoot, "deploy/docker-compose.yml"), "utf8");
  // The hosted MCP endpoint is latency-critical and idle most of the time;
  // on the shared production host it starved at the default CPU weight
  // (Nov 24, 2026: 14-30 ms direct vs ~2 s public under load). The weight
  // only matters under contention and caps nothing.
  assert.match(compose, /container_name:\s*solvelang-mcp-remote/);
  assert.match(compose, /cpu_shares:\s*8192/);
});
