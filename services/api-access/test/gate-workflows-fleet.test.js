import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const GATE_WORKFLOWS = ["ci.yml", "rust.yml", "workflow-syntax.yml", "merge-governance-ci.yml"];

async function workflowText(name) {
  return readFile(
    new URL(`../../../.github/workflows/${name}`, import.meta.url),
    "utf8",
  );
}

function runsOnSets(text) {
  return [...text.matchAll(/runs-on: \[([^\]]+)\]/g)].map((match) =>
    match[1].split(",").map((label) => label.trim()),
  );
}

for (const name of GATE_WORKFLOWS) {
  test(`${name}: every job places on the fleet-wide label set`, async () => {
    const text = await workflowText(name);
    const sets = runsOnSets(text);
    assert.ok(sets.length >= 1, `${name} must declare runs-on labels`);
    for (const labels of sets) {
      assert.deepEqual(labels, ["self-hosted", "solvelang-ci"]);
    }
    assert.ok(!text.includes("solvelang-flex"), `${name} must not use the two-pool flex label`);
    assert.ok(!text.includes("oracle-free"), `${name} must not pin to the Oracle pool`);
  });
}

for (const name of ["ci.yml", "rust.yml", "merge-governance-ci.yml"]) {
  test(`${name}: POSIX steps are pinned to bash for Windows placements`, async () => {
    const text = await workflowText(name);
    assert.match(text, /defaults:\s*\n\s*run:\s*\n\s*shell: bash/);
  });
}

test("workflow-syntax: actionlint install covers Windows natively", async () => {
  const text = await workflowText("workflow-syntax.yml");
  assert.match(text, /windows_x86_64/);
  assert.match(text, /runner\.os == 'Windows'/);
  assert.match(text, /runner\.os != 'Windows'/);
});
