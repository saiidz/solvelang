import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
const require = createRequire(import.meta.url);
const { primaryLinks, toolLinks } = require("../.studio-test-dist/public-site/components/site-navigation.js");
const { billingAvailability } = require("../.studio-test-dist/public-site/product-capabilities.js");
const root = fileURLToPath(new URL("../out/", import.meta.url));
const routes = new Set(["/", "/landing/", "/privacy-policy/", "/terms/", ...primaryLinks.map(x => x.href), ...toolLinks.map(x => x.href)]);
for (const route of routes) test(`static export has shared navigation and valid destinations: ${route}`, () => {
  const file = join(root, route, "index.html");
  assert.ok(existsSync(file), `${route} must be exported`);
  const html = readFileSync(file, "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  assert.equal((html.match(/data-site-header="true"/g) || []).length, 1, "exactly one shared header");
  assert.equal((html.match(/aria-label="Primary navigation"/g) || []).length, 1);
  assert.match(html, /id="site-content"/);
  for (const { href } of primaryLinks) assert.ok(html.includes(`href="${href}"`), `missing ${href} on ${route}`);
  assert.ok(!html.includes('href="/account/"'), "no nonexistent Account target");
});
test("exported status retains the archive and does not SSR an unsupported healthy badge", () => {
  const html = readFileSync(join(root, "status/index.html"), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  assert.match(html, /Historical incident records/);
  assert.match(html, /GitHub Actions upstream degradation/);
  assert.match(html, /archived/);
  assert.doesNotMatch(html, /No recorded incidents\./);
  assert.doesNotMatch(html, /data-health-state="operational"/);
  assert.match(html, /Reporting mode: live observations \+ manual incident history/);
  assert.match(html, /Current health not fully verified/);
});
test("exported homepage links to canonical status and has no server-rendered green claim", () => {
  const html = readFileSync(join(root, "index.html"), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  assert.match(html, /Current public status/);
  assert.match(html, /View system status/);
  assert.match(html, /href="\/status\/"/);
  assert.doesNotMatch(html, /data-health-state="operational"/);
});
test("exported homepage Evidence uses shared billing capability text", () => {
  const html = readFileSync(join(root, "index.html"), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const evidence = html.match(/<section[^>]*id="evidence"[\s\S]*?<\/section>/)?.[0];
  assert.ok(evidence, "homepage Evidence section is exported");
  assert.ok(evidence.includes(billingAvailability), "Evidence billing status matches shared capability facts");
});

test("exported billing and legal pages keep current API terms and the shared rollout boundary", () => {
  const page = route => readFileSync(join(root, route, "index.html"), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const pricing = page("pricing");
  const apiPricing = page("api-pricing");
  const billing = page("billing");
  const terms = page("terms");
  const refund = page("refund-policy");
  for (const html of [pricing, apiPricing, billing]) assert.ok(html.includes(billingAvailability));
  assert.match(pricing, /href="\/api-pricing\/"/);
  assert.doesNotMatch(pricing, /API Starter|\$79|API Growth|Subscribe to Pro/);
  assert.match(apiPricing, /UPCOMINGSOUNDS S\.R\.L\./);
  assert.match(billing, /renew monthly until canceled/);
  assert.match(terms, /API subscriptions/);
  assert.match(refund, /API subscription cancellation and refunds/);
  for (const html of [terms, billing, refund]) assert.doesNotMatch(html, /Production checkout remains blocked|Subscriptions are inactive/);
});
