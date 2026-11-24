import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Step 1 G4 (QA): pin the root README checkpoint wording. The 2026-09-15
// reconciliation date stays (it records when the reconciliation happened);
// the internal PR references (#920, #913–#920, #941) stay out.

function resolveFromHere(...urls: string[]): URL {
  for (const url of urls) {
    const candidate = new URL(url, import.meta.url);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return new URL(urls[0], import.meta.url);
}

test("root README keeps the reconciliation date without internal PR references", async () => {
  const readme = await readFile(
    resolveFromHere("../../../../README.md", "../../../README.md"),
    "utf8",
  );
  assert.ok(
    readme.includes(
      "This README was reconciled on **2026-09-15** against repository state. Live GitHub state always wins if that checkpoint becomes stale.",
    ),
    "README carries the cleaned reconciliation sentence with the date kept",
  );
  assert.ok(
    readme.includes("pinned real-source regressions and strict agent-measurement record/report contracts"),
    "README feature list carries the cleaned contracts phrase",
  );
  assert.ok(
    readme.includes("successful macOS ARM64 and Windows x64 candidate qualification; see"),
    "README carries the cleaned qualification sentence",
  );
  assert.ok(!readme.includes("through PR **#920**"), "the #920 checkpoint reference must not return");
  assert.ok(!readme.includes("#913\u2013#920"), "the #913-#920 range must not return");
  assert.ok(!readme.includes("qualification in #941"), "the #941 reference must not return");
});
