import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL(
  "../../../.github/workflows/wasm-artifact-security.yml",
  import.meta.url,
);

async function workflowText() {
  return readFile(workflowUrl, "utf8");
}

test("wasm audit job keeps its required-check name", async () => {
  const text = await workflowText();
  assert.match(text, /name: WASM artifact security/);
});

test("wasm audit places by capability labels, never by OS name", async () => {
  const text = await workflowText();
  const match = text.match(/runs-on: \[([^\]]+)\]/);
  assert.ok(match, "audit job must declare a runs-on label set");
  const labels = match[1].split(",").map((label) => label.trim());
  assert.deepEqual(labels, ["self-hosted", "ARM64", "solvelang-ci"]);
  for (const osLabel of ["Linux", "macOS", "Windows", "oracle-free"]) {
    assert.ok(
      !labels.includes(osLabel),
      `runs-on must not pin by host or OS label: ${osLabel}`,
    );
  }
});

test("wasm audit still runs the audited-artifact script", async () => {
  const text = await workflowText();
  assert.match(text, /bash solvec-wasm\/qa\/build-audited-artifact\.sh/);
  assert.match(text, /verify-site-artifact\.cjs/);
});
