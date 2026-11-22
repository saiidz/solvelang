import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Step 1 G1/G5 + G2 (QA): pin the published-install wording in the package
// README (also the npm package page) and the Codex/Claude integration doc.
// The bare `npx --yes @solvelang/mcp-server@0.3.0` form fails against the
// published two-executable package; every surface must carry the explicit
// --package form, and the internal "#920" references must stay out.

function resolveFromHere(...urls: string[]): URL {
  for (const url of urls) {
    const candidate = new URL(url, import.meta.url);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return new URL(urls[0], import.meta.url);
}

const WORKING = "npx -y --package @solvelang/mcp-server@0.3.0 solvelang-mcp";
const FAILING = "npx --yes @solvelang/mcp-server@0.3.0";

test("package README carries the working install command and the two-executables note", async () => {
  const readme = await readFile(resolveFromHere("../../README.md", "../README.md"), "utf8");
  assert.ok(readme.includes(WORKING), "README states the working --package command");
  assert.ok(
    readme.includes(
      "The package ships two executables, so npx needs the explicit --package form above — the bare `npx @solvelang/mcp-server` form cannot choose one and fails.",
    ),
    "README explains why the explicit form is required",
  );
  assert.ok(!readme.includes(FAILING), "README must not state the failing bare form for 0.3.0");
  assert.ok(
    readme.includes("`npx --yes @solvelang/mcp-server@0.2.0` uses the historical package line"),
    "the historical 0.2.0 line stays untouched (single-executable release, still works)",
  );
});

test("package README summarizer sentence carries no internal issue reference", async () => {
  const readme = await readFile(resolveFromHere("../../README.md", "../README.md"), "utf8");
  assert.ok(
    readme.includes(
      "The summarizer itself makes no provider/network call and uses no credentials. Baseline/context record pairs must use the same outcome-evaluation basis and required-evidence denominator in addition to the same fixture/provider/model/agent/record class.",
    ),
    "README carries the cleaned summarizer sentence verbatim",
  );
  assert.ok(!readme.includes("After #920,"), "the #920 reference must not return to the README");
});

test("Codex/Claude integration doc carries the working forms and the cleaned sentence", async () => {
  const doc = await readFile(
    resolveFromHere(
      "../../../../docs/integrations/mcp-codex-claude.md",
      "../../../docs/integrations/mcp-codex-claude.md",
    ),
    "utf8",
  );
  assert.ok(
    doc.includes('args = ["-y", "--package", "@solvelang/mcp-server@0.3.0", "solvelang-mcp"]'),
    "doc states the working Codex TOML args",
  );
  assert.ok(
    doc.includes(`solvelang -- ${WORKING}`),
    "doc states the working Claude Code registration command",
  );
  assert.ok(
    doc.includes(
      "The summarizer itself performs no provider/network call and uses no credentials. Baseline/context records must remain truly comparable, including the same outcome-evaluation basis and required-evidence denominator.",
    ),
    "doc carries the cleaned summarizer sentence verbatim",
  );
  assert.ok(!doc.includes(FAILING), "doc must not state the failing bare form for 0.3.0");
  assert.ok(!doc.includes("after #920"), "the #920 reference must not return to the doc");
});
