import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
const require = createRequire(import.meta.url);
const { primaryLinks, toolLinks } = require("../.studio-test-dist/public-site/components/site-navigation.js");
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
});
