import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Step 1 G1/G5 + G2 (QA), re-pinned for 0.4.0: pin the published-install
// wording in the package README (also the npm package page) and the
// Codex/Claude integration doc. The 0.4.0 package ships a single executable,
// so the bare `npx --yes @solvelang/mcp-server@0.4.0` form works; the stale
// 0.3.0 --package form must not return, and the internal "#920" references
// must stay out.

function resolveFromHere(...urls: string[]): URL {
  for (const url of urls) {
    const candidate = new URL(url, import.meta.url);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return new URL(urls[0], import.meta.url);
}

const WORKING = "npx --yes @solvelang/mcp-server@0.4.0";
const STALE = "npx -y --package @solvelang/mcp-server@0.3.0 solvelang-mcp";

test("package README carries the working install command and the single-executable note", async () => {
  const readme = await readFile(resolveFromHere("../../README.md", "../README.md"), "utf8");
  assert.ok(readme.includes(WORKING), "README states the working bare npx command");
  assert.ok(
    readme.includes(
      "The package ships a single executable (solvelang-mcp), so the bare npx form above works — no --package form is needed.",
    ),
    "README explains why the bare form works",
  );
  assert.ok(!readme.includes(STALE), "README must not state the stale 0.3.0 --package form");
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
    doc.includes('args = ["-y", "@solvelang/mcp-server@0.4.0"]'),
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
  assert.ok(!doc.includes("@solvelang/mcp-server@0.3.0"), "doc must not state the stale 0.3.0 package");
  assert.ok(!doc.includes("after #920"), "the #920 reference must not return to the doc");
});
