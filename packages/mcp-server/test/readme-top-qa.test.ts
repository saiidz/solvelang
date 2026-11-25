import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

// README top block (QA for the browser-run capture PR), re-pinned for the
// 0.4.0 release: pin the badge block, the capture line, the tagline lift,
// the verification note, and the working MCP one-liner at the top of the
// ROOT README. The 0.4.0 package ships a single executable, so the bare
// `npx --yes @solvelang/mcp-server@0.4.0` form is the working one-liner.

function resolveFromHere(...urls: string[]): URL {
  for (const url of urls) {
    const candidate = new URL(url, import.meta.url);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return new URL(urls[0], import.meta.url);
}

const BADGE_LINE =
  "[![CI](https://github.com/saiidz/solvelang/actions/workflows/ci.yml/badge.svg)](https://github.com/saiidz/solvelang/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@solvelang/mcp-server)](https://www.npmjs.com/package/@solvelang/mcp-server) [![saiidz/solvelang MCP server](https://glama.ai/mcp/servers/saiidz/solvelang/badges/score.svg)](https://glama.ai/mcp/connectors/io.github.saiidz/solvelang)";
const CAPTURE_LINE =
  "![SolveLang running in the browser: a two-file workspace executes locally and prints its deterministic output](docs/demo/solvelang-run.gif)";
const TAGLINE =
  "> **A readable, explainable workflow language and local-first analysis toolkit for AI-assisted business and coding workflows.**";
const WORKING = "npx --yes @solvelang/mcp-server@0.4.0";
const FAILING = "npx --yes @solvelang/mcp-server@0.3.0";

async function rootReadme(): Promise<string> {
  return readFile(resolveFromHere("../../../README.md", "../../../../README.md"), "utf8");
}

test("root README opens with title, badge block, then the capture", async () => {
  const lines = (await rootReadme()).split("\n");
  assert.equal(lines[0], "# SolveLang", "title stays the first line");
  assert.equal(lines[2], BADGE_LINE, "badge block sits directly under the title");
  assert.equal(lines[4], CAPTURE_LINE, "capture sits directly under the badge block");
});

test("tagline leads; the dated verification note follows it unchanged", async () => {
  const readme = await rootReadme();
  const taglineAt = readme.indexOf(TAGLINE);
  const noteAt = readme.indexOf("## Current verification \u2014 2026-09-20");
  assert.ok(taglineAt >= 0, "tagline present");
  assert.ok(noteAt > taglineAt, "verification note moved below the tagline");
  assert.ok(
    readme.includes("MCP v0.4.0 is published on npm and GitHub; main protection is enforced."),
    "verification note line 1 tracks the current release",
  );
  assert.ok(readme.includes("Older checkpoints below are historical."), "verification note line 2 unchanged");
});

test("working MCP one-liner sits near the top; the failing bare form is absent", async () => {
  const readme = await rootReadme();
  const cmdAt = readme.indexOf(WORKING);
  const noteAt = readme.indexOf("## Current verification \u2014 2026-09-20");
  assert.ok(cmdAt >= 0, "working bare npx command present");
  assert.ok(cmdAt < noteAt, "one-liner sits above the verification note, near the top");
  assert.ok(!readme.includes(FAILING), "the stale 0.3.0 bare npx form must not appear");
});

test("the capture asset is a real GIF of sane size", async () => {
  const gif = await readFile(
    resolveFromHere("../../../docs/demo/solvelang-run.gif", "../../../../docs/demo/solvelang-run.gif"),
  );
  assert.equal(gif.subarray(0, 6).toString("ascii"), "GIF89a", "asset is a GIF89a");
  assert.ok(gif.length > 10_000, "asset is not a stub");
  assert.ok(gif.length < 5_000_000, "asset stays under 5 MB for README rendering");
});
