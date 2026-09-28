import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
const require = createRequire(import.meta.url);
const { primaryLinks, toolLinks, normalizePath, isCurrentLink } = require("../.studio-test-dist/public-site/components/site-navigation.js");
const { statusPage } = require("../.studio-test-dist/public-site/(english)/status/status-data.js");
const { observedState, overallState, isCurrentIncident, MAX_HEALTH_AGE_MS } = require("../.studio-test-dist/public-site/(english)/status/status-health.js");
const { parseStatusObservations, fetchStatusObservations } = require("../.studio-test-dist/public-site/(english)/status/status-live.js");
const { capabilityGroups, billingAvailability } = require("../.studio-test-dist/public-site/product-capabilities.js");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const now = Date.parse("2026-09-13T21:00:00Z");
const healthy = { name: "Test", description: "Test fixture, not live evidence", state: "operational", checkedAt: new Date(now - 1000).toISOString(), validForMs: 60_000 };

test("navigation uses the shared account menu and unique internal destinations", () => {
  assert.equal(primaryLinks.some((link) => link.label === "Account"), false);
  assert.match(read("app/components/SiteHeader.tsx"), /<SiteAccountMenu\s*\/>/);
  const accountMenu = read("app/components/SiteAccountMenu.tsx");
  assert.match(accountMenu, /\/customer\/account/);
  assert.match(accountMenu, /\/customer\/auth\/logout/);
  assert.match(accountMenu, /csrfToken: account\.csrfToken/);
  assert.match(accountMenu, /Signed in as/);
  assert.match(accountMenu, /Sign out/);
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
  assert.equal(observedState(undefined, now), "not_monitored");
  assert.equal(overallState(statusPage.components.map(() => undefined), now), "not_monitored");
  assert.ok(statusPage.components.some((component) => component.monitored));
  assert.ok(statusPage.components.some((component) => !component.monitored));
});
test("a single healthy component cannot hide unknown components", () => {
  assert.equal(overallState([healthy, { ...healthy, state: "not_monitored" }], now), "not_monitored");
  assert.equal(overallState([], now), "not_monitored");
  assert.equal(overallState([healthy], now), "operational");
});
test("recent outages take precedence without inventing healthy unmeasured components", () => {
  assert.equal(overallState([healthy, { ...healthy, state: "degraded" }], now), "degraded");
  assert.equal(overallState([healthy, { ...healthy, state: "partial_outage" }], now), "partial_outage");
  assert.equal(overallState([{ ...healthy, state: "not_monitored" }, { ...healthy, state: "major_outage" }], now), "major_outage");
});
test("expired, missing, invalid and future evidence fail closed", () => {
  for (const patch of [{ checkedAt: undefined }, { checkedAt: "bad" }, { checkedAt: new Date(now + 1).toISOString() }, { validForMs: 0 }, { validForMs: undefined }, { validForMs: Infinity }]) {
    assert.equal(observedState({ ...healthy, ...patch }, now), "not_monitored");
  }
  assert.equal(observedState(healthy, now + 60_000), "not_monitored");
  assert.equal(observedState({ ...healthy, validForMs: 86_400_000 }, now + MAX_HEALTH_AGE_MS), "not_monitored");
});
test("live payload parser requires every monitored observation and discards malformed values", () => {
  const observations = Object.fromEntries(statusPage.components.filter((component) => component.monitored).map((component) => [component.id, healthy]));
  const valid = parseStatusObservations({ observations });
  assert.equal(Object.keys(valid).length, Object.keys(observations).length);
  assert.equal(overallState(statusPage.components.map((component) => valid[component.id]), now), "not_monitored", "unmonitored components prevent an all-green claim");
  assert.deepEqual(parseStatusObservations({ observations: { ...observations, website: { ...healthy, state: "invented" } } }), {});
  assert.deepEqual(parseStatusObservations({ observations: { website: healthy } }), {});
  assert.deepEqual(parseStatusObservations({ observations: null }), {});
  assert.deepEqual(parseStatusObservations({ observations: { ...observations, website: { ...healthy, checkedAt: "future?" } } }), {});
});
test("failed and malformed public status fetches become unverified without credentials", async () => {
  const base = "https://api.example.test";
  const failed = async () => { throw new Error("private backend detail"); };
  assert.deepEqual(await fetchStatusObservations(base, failed), {});
  assert.deepEqual(await fetchStatusObservations(base, async () => new Response("not json", { status: 200, headers: { "content-type": "application/json" } })), {});
  assert.deepEqual(await fetchStatusObservations(base, async () => new Response("x".repeat(17_000), { headers: { "content-type": "application/json" } })), {});
  assert.deepEqual(await fetchStatusObservations(undefined, failed), {});
  const calls = [];
  await fetchStatusObservations(base, async (url, options) => { calls.push([String(url), options]); return new Response("{}", { headers: { "content-type": "application/json" } }); });
  assert.equal(calls[0][0], `${base}/public/status/health`);
  assert.equal(calls[0][1].credentials, "omit");
  assert.equal(calls[0][1].cache, "no-store");
});
test("homepage and status use the one public status source without turning capability copy into health", () => {
  const view = read("app/(english)/status/StatusHealth.tsx");
  assert.match(view, /fetchStatusObservations\(API_BASE\)/);
  assert.match(view, /export function StatusDashboard\(\)/);
  assert.match(view, /export function StatusSummary\(\)/);
  assert.match(read("app/(english)/status/page.tsx"), /<StatusDashboard\s*\/>/);
  assert.match(read("app/(english)/landing/page.tsx"), /<StatusSummary\s*\/>/);
  assert.doesNotMatch(view, /billingAvailability|accountAvailability|previewAvailability/);
  assert.equal(statusPage.components.find((component) => component.id === "billing").monitored, false);
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
test("homepage, About, pricing, and status preserve controlled-rollout billing boundaries", () => {
  const landing = read("app/(english)/landing/page.tsx");
  assert.match(landing, /import \{ billingAvailability \} from "\.\.\/\.\.\/product-capabilities"/);
  assert.match(landing, /account saving are deployed\. \{billingAvailability\} Paid priority/);
  assert.doesNotMatch(landing, /Billing is enabled for controlled rollout; the first real-payment canary remains pending/);
  assert.match(landing, /Paid priority and general managed execution remain separate gates/);
  assert.match(read("app/(english)/about/page.tsx"), /<ProductCapabilities\s*\/>/);
  for (const page of ["api-pricing/page.tsx", "billing/page.tsx", "pricing/page.tsx", "status/status-data.ts"]) assert.match(read(`app/(english)/${page}`), /billingAvailability/);
  assert.match(billingAvailability, /Production API subscription billing/);
  assert.match(billingAvailability, /real-payment canary is still pending/);
  assert.match(read("app/brandFacts.ts"), /status: "production-canary"/);
  assert.match(read("public/llms.txt"), /Production API subscription billing and checkout verified enabled/);
  assert.equal(capabilityGroups.find((group) => group.id === "billing").description, billingAvailability);
  for (const page of ["landing", "about", "api-pricing"]) assert.doesNotMatch(read(`app/(english)/${page}/page.tsx`), /Test-mode API access, account|only in the protected SolveLang test environment/);
});
