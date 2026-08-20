import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const launchRunbookUrl = new URL("../../docs/production-launch-runbook.md", import.meta.url);

test("emergency billing disable requires verified mutation blocking before re-enable", async () => {
  const runbook = await readFile(launchRunbookUrl, "utf8");

  assert.match(runbook, /## Emergency disable order/);
  assert.match(runbook, /post-disable evidence that new checkout and plan-change mutations are blocked/);
  assert.match(runbook, /Do not re-enable a mutation path solely because an alert stops firing/);
  assert.match(runbook, /owner-recorded decision/);
});
