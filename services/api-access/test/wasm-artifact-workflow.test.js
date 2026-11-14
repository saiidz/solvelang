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

// Placement policy changed by owner order (Nov 14, 2026): PR batteries run on
// GitHub-hosted runners (free for this public repo). This pin replaces the
// former fleet-label pin from #1188; it still fails CI on any silent
// placement drift, and it still forbids self-hosted host/OS/arch pins.
test("wasm audit places on GitHub-hosted ubuntu-latest", async () => {
  const text = await workflowText();
  const match = text.match(/runs-on: (\S+)/);
  assert.ok(match, "audit job must declare a runs-on");
  assert.equal(match[1], "ubuntu-latest");
  for (const pin of ["self-hosted", "Linux", "macOS", "Windows", "ARM64", "X64", "oracle-free", "solvelang-ci", "solvelang-flex"]) {
    assert.ok(
      !match[1].includes(pin),
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
