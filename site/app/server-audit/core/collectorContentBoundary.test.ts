import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const collectorPath = resolve(process.cwd(), "..", "tools", "server-audit", "collect.mjs");

function collectorSource() {
  return readFileSync(collectorPath, "utf8");
}

test("collector file-content reads stay limited to reviewed host configuration", () => {
  const source = collectorSource();
  const readCalls = source.match(/readFileSync\(/g) ?? [];

  assert.equal(readCalls.length, 2, "new file-content reads require explicit privacy review");
  assert.match(source, /readFileSync\("\/etc\/os-release", "utf8"\)/);
  assert.match(source, /readFileSync\(path, "utf8"\)/);

  const firstMatchCalls = [...source.matchAll(/firstMatch\("([^"]+)", "([^"]+)"\)/g)]
    .map((match) => [match[1], match[2]] as const);

  assert.deepEqual(firstMatchCalls, [
    ["/etc/ssh/sshd_config", "PermitRootLogin"],
    ["/etc/ssh/sshd_config", "PasswordAuthentication"],
  ]);
});

test("collector never reads candidate web, cron, backup, log, or credential file contents", () => {
  const source = collectorSource();

  assert.doesNotMatch(source, /readFileSync\([^\n]*(?:root\.path|publicHtml|\/var\/www|\/srv\/www|\/home)/);
  assert.doesNotMatch(source, /readFileSync\([^\n]*(?:cron|backup|backups|\/var\/log)/i);
  assert.doesNotMatch(source, /readFileSync\([^\n]*(?:\.env|\.npmrc|auth\.json|private[-_ ]?key|credential|secret)/i);
  assert.match(source, /command content intentionally not collected/);
  assert.match(source, /Sensitive public-file checks record only existence booleans/);
});
