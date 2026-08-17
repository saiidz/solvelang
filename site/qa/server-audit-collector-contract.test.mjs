import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const collectorUrl = new URL("../../tools/server-audit/collect.mjs", import.meta.url);
const docsUrl = new URL("../../docs/product/server-audit-v0.md", import.meta.url);

const ALLOWED_PROGRAMS = [
  "aa-status",
  "df",
  "dpkg-query",
  "firewall-cmd",
  "getenforce",
  "openssl",
  "ps",
  "rpm",
  "ss",
  "systemctl",
  "ufw",
];

test("server audit collector accepts no user command arguments and contains no mutation utilities", async () => {
  const source = await readFile(collectorUrl, "utf8");
  assert.doesNotMatch(source, /process\.argv\[[2-9]/);
  assert.doesNotMatch(source, /\bsudo\b|\bapt(?:-get)?\s+(?:install|remove|upgrade)|\byum\s+(?:install|remove|update)|\bdnf\s+(?:install|remove|upgrade)|\bsystemctl\s+(?:restart|reload|stop|start|enable|disable)|\bchmod\b|\bchown\b|\brm\s+-|\bmv\s+|\bcp\s+/);
  assert.doesNotMatch(source, /process\.env(?!\.PATH)/);
  assert.match(source, /redactionsApplied:\s*true/);
  assert.match(source, /command content intentionally not collected/);
  assert.match(source, /command\("ps", \["-eo", "pid=,ppid=,uid=,stat=,comm="\]\)/);
  assert.match(source, /Process inventory contains PID, parent PID, numeric uid, state, and executable comm name only/);
  assert.match(source, /Environment variables, file contents, database contents, private keys, credentials, process command lines, and cron command bodies are not collected/);
});

test("server audit collector command surface stays literal and read-only allowlisted", async () => {
  const source = await readFile(collectorUrl, "utf8");
  const commandLines = source
    .split("\n")
    .filter((line) => line.includes("command(") && !line.includes("function command("));

  assert.ok(commandLines.length > 0);
  for (const line of commandLines) {
    assert.match(line, /command\("(?:aa-status|df|dpkg-query|firewall-cmd|getenforce|openssl|ps|rpm|ss|systemctl|ufw)"/);
  }

  const invokedPrograms = [...source.matchAll(/\bcommand\("([^"]+)"/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual([...new Set(invokedPrograms)].sort(), ALLOWED_PROGRAMS);
  assert.doesNotMatch(source, /\bexecSync\b|\bspawn(?:Sync)?\b|\bexecFile\s*\(/);
  assert.doesNotMatch(source, /shell\s*:\s*true/);
});

test("server audit product contract explicitly forbids remediation execution and secret collection", async () => {
  const docs = await readFile(docsUrl, "utf8");
  assert.match(docs, /does not use `sudo` or write to the target host/);
  assert.match(docs, /does not collect environment variables, private keys, credential files, database\/customer contents, process command lines, or cron command bodies/);
  assert.match(docs, /contains no remediation executor/);
  assert.match(docs, /sends no snapshot to a SolveLang API in v0/);
});