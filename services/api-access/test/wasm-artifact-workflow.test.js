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

test("wasm audit places on the fleet-wide label every runner carries", async () => {
  const text = await workflowText();
  const match = text.match(/runs-on: \[([^\]]+)\]/);
  assert.ok(match, "audit job must declare a runs-on label set");
  const labels = match[1].split(",").map((label) => label.trim());
  assert.deepEqual(labels, ["ubuntu-latest"]);
  for (const pin of ["Linux", "macOS", "Windows", "ARM64", "X64", "oracle-free"]) {
    assert.ok(
      !labels.includes(pin),
      `runs-on must not pin by host, OS, or arch label: ${pin}`,
    );
  }
});

test("wasm audit pins bash so Windows runs the POSIX steps under Git Bash", async () => {
  const text = await workflowText();
  assert.match(
    text,
    /Reproduce and audit browser artifact under hostile caller Cargo config\s*\n\s*shell: bash/,
  );
});

test("wasm audit resolves Chrome on Windows through CHROME_BIN", async () => {
  const text = await workflowText();
  assert.match(text, /runner\.os == 'Windows'/);
  assert.match(text, /CHROME_BIN=/);
});

test("wasm audit still runs the audited-artifact script", async () => {
  const text = await workflowText();
  assert.match(text, /bash solvec-wasm\/qa\/build-audited-artifact\.sh/);
  assert.match(text, /verify-site-artifact\.cjs/);
});
