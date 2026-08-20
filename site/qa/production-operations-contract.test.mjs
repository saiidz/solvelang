import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const operationsUrl = new URL("../../docs/production-operations.md", import.meta.url);

test("production operations runbook requires a sanitized incident record and verified closure", async () => {
  const runbook = await readFile(operationsUrl, "utf8");

  assert.match(runbook, /## Incident record and redaction gate/);
  assert.match(runbook, /unknown impact recorded as `unknown` rather than guessed/);
  assert.match(runbook, /sanitized request IDs or error codes/);
  assert.match(runbook, /Do not put live secrets, API keys, webhook payloads\/signing secrets/);
  assert.match(runbook, /raw log bodies, or recovery codes/);
  assert.match(runbook, /verified recovery, a completed state-preserving rollback, or an explicit handoff/);
  assert.match(runbook, /Do not mark recovery solely because an alert stopped firing/);
});
