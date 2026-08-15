import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const collectorUrl = new URL("../../tools/server-audit/collect.mjs", import.meta.url);
const docsUrl = new URL("../../docs/product/server-audit-v0.md", import.meta.url);

test("server audit collector accepts no user command arguments and contains no mutation utilities", async () => {
  const source = await readFile(collectorUrl, "utf8");
  assert.doesNotMatch(source, /process\.argv\[[2-9]/);
  assert.doesNotMatch(source, /\bsudo\b|\bapt(?:-get)?\s+(?:install|remove|upgrade)|\byum\s+(?:install|remove|update)|\bdnf\s+(?:install|remove|upgrade)|\bsystemctl\s+(?:restart|reload|stop|start|enable|disable)|\bchmod\b|\bchown\b|\brm\s+-|\bmv\s+|\bcp\s+/);
  assert.doesNotMatch(source, /process\.env(?!\.PATH)/);
  assert.match(source, /redactionsApplied:\s*true/);
  assert.match(source, /command content intentionally not collected/);
  assert.match(source, /Environment variables, file contents, database contents, private keys, credentials, process command lines, and cron command bodies are not collected/);
});

test("server audit product contract explicitly forbids remediation execution and secret collection", async () => {
  const docs = await readFile(docsUrl, "utf8");
  assert.match(docs, /does not use `sudo` or write to the target host/);
  assert.match(docs, /does not collect environment variables, private keys, credential files, database\/customer contents, process command lines, or cron command bodies/);
  assert.match(docs, /contains no remediation executor/);
  assert.match(docs, /sends no snapshot to a SolveLang API in v0/);
});
