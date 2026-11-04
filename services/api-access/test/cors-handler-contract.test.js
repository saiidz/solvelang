import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The API handler builds its own CORS headers for actual responses and
// short-circuits OPTIONS itself. Its allow-headers list must cover every
// header the customer site sends (see cors-gateway-contract.test.js):
// if the gateway ever passes a preflight through, or a response is
// inspected directly, a missing entry breaks browser calls the same way.
const REQUIRED_ALLOW_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "idempotency-key",
  "x-solvelang-admin-secret",
  "x-solvelang-csrf",
  "stripe-signature",
];

test("handler OPTIONS short-circuit returns the shared response shape", async () => {
  const source = await readFile(new URL("../src/api-handler.js", import.meta.url), "utf8");
  assert.match(
    source,
    /method === "OPTIONS"\) return response\(204, \{\}\)/,
    "OPTIONS must be answered with response(204) so it carries the standard CORS headers",
  );
});

test("handler CORS headers cover the site contract without opening the origin", async () => {
  const source = await readFile(new URL("../src/api-handler.js", import.meta.url), "utf8");

  const allowHeaders = source.match(/"access-control-allow-headers":\s*"([^"]+)"/);
  assert.ok(allowHeaders, "handler must set access-control-allow-headers");
  const listed = allowHeaders[1].split(",").map((h) => h.trim().toLowerCase());
  for (const required of REQUIRED_ALLOW_HEADERS) {
    assert.ok(listed.includes(required), `handler allow-headers must include ${required}`);
  }

  assert.match(source, /"access-control-allow-origin":\s*siteOrigin/, "allow-origin must stay pinned to the configured site origin");
  assert.ok(!/"access-control-allow-origin":\s*"\*"/.test(source), "allow-origin must never be a wildcard");
  assert.match(source, /"access-control-allow-credentials":\s*"true"/, "credentialed calls require allow-credentials: true");
  assert.match(source, /"access-control-allow-methods":\s*"GET,POST,OPTIONS"/, "allow-methods must cover GET, POST, OPTIONS");
});
