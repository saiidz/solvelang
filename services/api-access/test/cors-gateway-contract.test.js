import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The customer site (site/app/account/core/customer-api.ts) sends these
// headers on its credentialed API calls. A browser preflight lists every
// non-simple header, and API Gateway only answers the preflight when each
// one is present in the HttpApi CorsConfiguration AllowHeaders. A single
// missing entry (this regressed once: "accept" was absent) makes the
// gateway return a bare 204 with no access-control headers, and every
// browser sign-in / checkout POST dies with "Failed to fetch" while
// direct non-browser calls keep working.
const REQUIRED_ALLOW_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "idempotency-key",
  "x-solvelang-csrf",
];

function corsBlock(template) {
  const start = template.indexOf("CorsConfiguration:");
  assert.notEqual(start, -1, "template.yaml must define CorsConfiguration on the HttpApi");
  const rest = template.slice(start);
  const end = rest.indexOf("\n      Auth:");
  assert.notEqual(end, -1, "CorsConfiguration block must be followed by the Auth section");
  return rest.slice(0, end);
}

function listAfter(block, key) {
  const at = block.indexOf(key);
  assert.notEqual(at, -1, `CorsConfiguration must define ${key}`);
  const tail = block.slice(at + key.length);
  // Inline flow form: "AllowMethods: [GET, POST, OPTIONS]"
  const firstLine = tail.split("\n")[0];
  const flow = firstLine.match(/\[([^\]]*)\]/);
  if (flow) return flow[1].split(",").map((item) => item.trim()).filter(Boolean);
  // Block form: following lines of "- item"
  const items = [];
  for (const line of tail.split("\n").slice(1)) {
    const match = line.match(/^\s+-\s+(\S+)\s*$/);
    if (!match) break;
    items.push(match[1]);
  }
  return items;
}

test("gateway CORS answers browser preflights for every header the site sends", async () => {
  const template = await readFile(new URL("../template.yaml", import.meta.url), "utf8");
  const block = corsBlock(template);

  assert.match(block, /AllowCredentials:\s*true/, "credentialed calls require AllowCredentials: true");
  // AllowOrigins must stay a PLAIN list. An !If wrapper around it reaches the
  // deployed API body unevaluated (SAM bakes the branch literals but keeps the
  // Fn::If), API Gateway cannot evaluate it, and every preflight returns a
  // bare 204 with no access-control headers. That is exactly how browser
  // sign-in/checkout broke while the template looked correct. The production
  // StudioAcceptanceOrigin parameter is empty (acceptance origin disabled),
  // so the plain site-only list is the production truth.
  assert.ok(!/AllowOrigins:\s*!If/.test(block), "AllowOrigins must not be wrapped in !If: the wrapper reaches API Gateway unevaluated and preflights fail");
  assert.ok(!/StudioAcceptanceOrigin/.test(block), "CorsConfiguration must not reference StudioAcceptanceOrigin: production runs with the acceptance origin disabled");
  assert.match(block, /AllowOrigins:\s*\n\s+-\s+!Ref SiteOrigin\s*\n/, "AllowOrigins must be exactly the site origin");
  assert.ok(!/AllowOrigins:[\s\S]*?-\s+["']?\*["']?(\s|$)/.test(block), "AllowOrigins must never be a wildcard");

  const methods = listAfter(block, "AllowMethods:");
  for (const method of ["GET", "POST", "OPTIONS"]) {
    assert.ok(methods.includes(method), `AllowMethods must include ${method}`);
  }

  const headers = listAfter(block, "AllowHeaders:").map((h) => h.toLowerCase());
  for (const required of REQUIRED_ALLOW_HEADERS) {
    assert.ok(headers.includes(required), `AllowHeaders must include ${required} or browser preflights fail`);
  }
});
