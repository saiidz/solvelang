import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// QA pins for the repo security scan wiring: the flag is parsed in
// config.js under the exact env name the SAM template passes, the
// module is constructed in handler.js and handed to the API
// handler, the route dispatches on the exact public path, and the
// scan module itself stays self-contained (no imports from the
// account/ledger/Stripe/GitHub-App code) with the receipt label
// vocabulary and no risk-score machinery.

const root = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("config parses SECURITY_SCAN_ENABLED fail-closed", async () => {
  const source = await read("services/api-access/src/config.js");
  assert.match(source, /securityScanEnabled: environment\.SECURITY_SCAN_ENABLED === "true"/);
  assert.match(source, /\.\.\.securityScan\(environment\),/);
});

test("handler constructs the scan and passes it to the API handler", async () => {
  const source = await read("services/api-access/src/handler.js");
  assert.match(source, /import \{ createRepoSecurityScan \} from "\.\/repo-security-scan\.js";/);
  assert.match(source, /createRepoSecurityScan\(\{ enabled: environment\.securityScanEnabled \}\)/);
  assert.match(source, /^\s+repoSecurityScan,$/m);
});

test("api handler dispatches the public scan route with the disabled refusal", async () => {
  const source = await read("services/api-access/src/api-handler.js");
  assert.match(source, /repoSecurityScan = null,/);
  assert.match(source, /path\.endsWith\("\/public\/repo-security-scan"\)/);
  assert.match(source, /ApiAccessError\(503, "security_scan_disabled"/);
  const handleCall = source.slice(source.indexOf("repoSecurityScan.handle({"));
  assert.ok(handleCall.includes("method,"), "handle receives the method");
  assert.ok(handleCall.includes("bodyText: bodyText(event),"), "handle receives the raw body");
  assert.ok(handleCall.includes('source: event?.requestContext?.http?.sourceIp ?? "unknown",'), "handle receives the source address");
});

test("the scan module is self-contained and keeps the label discipline", async () => {
  const source = await read("services/api-access/src/repo-security-scan.js");
  assert.equal(/from\s+"\.\//.test(source), false, "scan module imports no sibling service modules");
  assert.equal(/from\s+"node:/.test(source), false, "scan module needs no node builtins beyond Buffer/fetch globals");
  for (const label of ["verified", "failed", "unverified"]) {
    assert.ok(source.includes(`"${label}"`), `label ${label} present`);
  }
  assert.equal(/riskScore|risk_score|risk-score/i.test(source), false, "no risk scores anywhere in the scan");
  assert.match(source, /SECURITY_SCAN_RATE_LIMIT = Object\.freeze\(\{ limit: 60, windowMs: 60_000 \}\)/);
  assert.match(source, /security_scan_disabled/);
});
