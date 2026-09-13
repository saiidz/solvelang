import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
const require = createRequire(import.meta.url);
const { primaryLinks, toolLinks, normalizePath, isCurrentLink } = require("../.studio-test-dist/public-site/components/site-navigation.js");
const { statusPage } = require("../.studio-test-dist/public-site/(english)/status/status-data.js");
const { observedState, overallState, isCurrentIncident, MAX_HEALTH_AGE_MS } = require("../.studio-test-dist/public-site/(english)/status/status-health.js");
const { capabilityGroups, billingAvailability } = require("../.studio-test-dist/public-site/product-capabilities.js");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const now = Date.parse("2026-09-13T21:00:00Z");
const healthy = { name: "Test", description: "Test fixture, not live evidence", state: "operational", checkedAt: new Date(now - 1000).toISOString(), validForMs: 60_000 };

test("navigation uses implemented account entry and unique internal destinations", () => {
  assert.equal(primaryLinks.find((link) => link.label === "Account").href, "/account/api-keys/");
  const links = [...primaryLinks, ...toolLinks];
  assert.equal(new Set(links.map((link) => link.href)).size, links.length);
  for (const link of links) {
    assert.ok(link.href.startsWith("/") && link.href.endsWith("/"));
    assert.ok(read(`app/(english)${link.href}page.tsx`));
  }
});
test("active route matching handles direct loads, trailing slashes, query, and account children", () => {
  assert.equal(normalizePath("/run/?x=1#source"), "/run");
  assert.equal(normalizePath(null), "/");
  assert.ok(isCurrentLink("/run", "/run/"));
  assert.ok(isCurrentLink("/run/", "/run/"));
  assert.ok(isCurrentLink("/account/api-subscription/", "/account/api-keys/"));
  assert.equal(isCurrentLink("/runner", "/run/"), false);
  assert.equal(isCurrentLink("/audit/", "/"), false);
});
test("one global header has no route exclusions and a real skip target", () => {
  const layout = read("app/(english)/layout.tsx");
  const header = read("app/components/SiteHeader.tsx");
  assert.equal((layout.match(/<SiteHeader\s*\/>/g) || []).length, 1);
  assert.match(layout, /id="site-content"/);
  assert.doesNotMatch(header, /selfNavigatedRoutes|return null/);
  assert.match(header, /aria-current/);
  assert.match(header, /#site-content/);
  assert.match(header, /Escape/);
  assert.match(header, /pointerdown/);
  assert.match(header, /key=\{route\}/);
  for (const route of ["landing", "about", "api-pricing", "check", "repository-audit", "run"]) {
    const page = read(`app/(english)/${route}/page.tsx`);
    assert.doesNotMatch(page, /<SiteHeader|aria-label="SolveLang home"/);
  }
});
test("deployed configuration is not manufactured health evidence", () => {
  for (const component of statusPage.components) assert.equal(observedState(component, now), "not_monitored");
  assert.equal(overallState(statusPage.components, now), "not_monitored");
});
test("a single healthy component cannot hide unknown components", () => {
  assert.equal(overallState([healthy, { ...healthy, state: "not_monitored" }], now), "not_monitored");
  assert.equal(overallState([], now), "not_monitored");
  assert.equal(overallState([healthy], now), "operational");
});
test("recent outages take precedence without inventing healthy unmeasured components", () => {
  assert.equal(overallState([healthy, { ...healthy, state: "degraded" }], now), "degraded");
  assert.equal(overallState([{ ...healthy, state: "not_monitored" }, { ...healthy, state: "major_outage" }], now), "major_outage");
});
test("expired, missing, invalid and future evidence fail closed", () => {
  for (const patch of [{ checkedAt: undefined }, { checkedAt: "bad" }, { checkedAt: new Date(now + 1).toISOString() }, { validForMs: 0 }, { validForMs: undefined }, { validForMs: Infinity }]) {
    assert.equal(observedState({ ...healthy, ...patch }, now), "not_monitored");
  }
  assert.equal(observedState(healthy, now + 60_000), "not_monitored");
  assert.equal(observedState({ ...healthy, validForMs: 86_400_000 }, now + MAX_HEALTH_AGE_MS), "not_monitored");
});
test("incident history survives refresh without a fabricated resolution", () => {
  const history = statusPage.incidents.find((incident) => incident.id === "2026-08-06-github-actions");
  assert.ok(history);
  assert.equal(history.state, "archived");
  assert.equal(history.resolvedAt, undefined);
  assert.equal(history.updates.length, 3);
  assert.equal(isCurrentIncident(history), false);
  assert.equal(isCurrentIncident({ ...history, state: "monitoring" }), true);
  assert.doesNotMatch(read("app/(english)/status/page.tsx"), /No recorded incidents\./);
});
test("homepage and About share one capability inventory; pricing and status preserve billing-off distinction", () => {
  for (const page of ["landing", "about"]) assert.match(read(`app/(english)/${page}/page.tsx`), /<ProductCapabilities\s*\/>/);
  for (const page of ["api-pricing/page.tsx", "status/status-data.ts"]) assert.match(read(`app/(english)/${page}`), /billingAvailability/);
  assert.match(billingAvailability, /API subscription billing is disabled/);
  assert.match(billingAvailability, /Separate checkout services/);
  assert.match(read("app/brandFacts.ts"), /accountAvailability/);
  assert.match(read("public/llms.txt"), /API subscription billing is disabled/);
  assert.equal(capabilityGroups.find((group) => group.id === "disabled").description, billingAvailability);
  for (const page of ["landing", "about", "api-pricing"]) assert.doesNotMatch(read(`app/(english)/${page}/page.tsx`), /Test-mode API access, account|only in the protected SolveLang test environment/);
});
