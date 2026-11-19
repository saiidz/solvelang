import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
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
  const header = read("app/components/SiteHeader.tsx");
  assert.doesNotMatch(header, /SiteAccountMenu/);
  assert.equal(existsSync(new URL("../app/components/SiteAccountMenu.tsx", import.meta.url)), false);
  assert.match(header, /\/customer\/account/);
  assert.match(header, /\/customer\/auth\/logout/);
  assert.match(header, /csrfToken: account\.csrfToken/);
  assert.match(header, /Signed in as/);
  assert.match(header, /Sign out/);
  assert.match(header, /\/account\/live-center\//);
  assert.match(header, />Live Center</);
  assert.match(read("app/(english)/account/api-keys/page.tsx"), /\/account\/live-center\//);
  const links = [...primaryLinks, ...toolLinks];
  assert.equal(new Set(links.map((link) => link.href)).size, links.length);
  for (const link of links) {
    assert.ok(link.href.startsWith("/") && link.href.endsWith("/"));
    assert.ok(read(`app/(english)${link.href}page.tsx`));
  }
});
test("account, checkout, and services surfaces present the per-pull-request pool choice with the exact labels", () => {
  const home = read("app/account/home/AccountHome.tsx");
  assert.match(home, /Choose the pool per pull request/);
  assert.ok(home.includes("solvelang-runners-high-power"), "account home names the High-Power PR label");
  assert.ok(home.includes("solvelang-runners-standard"), "account home names the Standard PR label");
  assert.match(home, /Jobs already running are not moved/);
  assert.match(home, /the balance its minutes are\s*billed to/);
  const checkout = read("app/account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout.tsx");
  assert.match(checkout, /choose per pull request/);
  assert.ok(checkout.includes("solvelang-runners-high-power"), "checkout names the High-Power PR label");
  assert.ok(checkout.includes("solvelang-runners-standard"), "checkout names the Standard PR label");
  const services = read("app/(english)/services/page.tsx");
  assert.match(services, /Pool choice per pull request/);
  assert.match(services, /also work as pull request labels/);
});

test("live center tab counts read the totals their views show", () => {
  const boardSource = read("app/account/live-center/LiveCenterBoard.tsx");
  const counterStart = boardSource.indexOf("const tabCounter");
  assert.ok(counterStart >= 0, "the board defines its tab counter");
  const counter = boardSource.slice(counterStart, boardSource.indexOf("};", counterStart));
  assert.match(counter, /case "prs":\s*\n\s*return String\(board\.pullRequests\.length\)/);
  assert.match(counter, /case "queue":\s*\n\s*return String\(board\.pullRequests\.length\)/);
  assert.match(counter, /case "runs":\s*\n\s*return String\(board\.runs\.length\)/);
  assert.match(counter, /case "runners":\s*\n\s*return String\(board\.runners\.busyCount\)/);
  assert.match(counter, /case "inbox":\s*\n\s*return String\(board\.inboxItems\)/);
  assert.equal(counter.includes('case "overview"'), false, "Overview carries no count");
  assert.equal(counter.includes('case "stats"'), false, "Statistics carries no count");
  assert.equal(counter.includes('case "minutes"'), false, "Minutes carries no count");
  assert.match(read("app/account/core/live-center.ts"), /const inboxItems = inboxGroups\.reduce/);
  assert.match(read("app/account/live-center/LiveCenterInbox.tsx"), /const totalItems = board\.inboxItems/);
});
test("header has exactly one menu, labelled Menu at every breakpoint, carrying the account links", () => {
  const header = read("app/components/SiteHeader.tsx");
  // Exactly one header dropdown exists, and the old account dropdown is gone.
  assert.equal((header.match(/data-site-menu="true"/g) || []).length, 1);
  assert.doesNotMatch(header, /SiteAccountMenu/);
  assert.equal(existsSync(new URL("../app/components/SiteAccountMenu.tsx", import.meta.url)), false);
  // The one menu is labelled "Menu" at every width: no xl "More" variant
  // and no breakpoint-swapped menu content remain.
  assert.match(header, />\s*Menu<span/);
  assert.doesNotMatch(header, />More</);
  assert.doesNotMatch(header, /xl:hidden/);
  assert.doesNotMatch(header, /hidden xl:inline/);
  // Signed-in items appear in order: the signed-in header line, the four
  // account destinations, the site/tool links, and Sign out last.
  const signedInAt = header.indexOf("Signed in as");
  const accountHomeAt = header.indexOf('href="/account/"');
  const apiAccountAt = header.indexOf('href="/account/api-keys/"');
  const liveCenterAt = header.indexOf('href="/account/live-center/"');
  const buyMinutesAt = header.indexOf('href="/account/runner-minutes-checkout/"');
  const toolLinksAt = header.indexOf("toolLinks.map");
  const signOutAt = header.indexOf(': "Sign out"}');
  for (const at of [signedInAt, accountHomeAt, apiAccountAt, liveCenterAt, buyMinutesAt, toolLinksAt, signOutAt]) assert.notEqual(at, -1);
  assert.ok(signedInAt < accountHomeAt && accountHomeAt < apiAccountAt && apiAccountAt < liveCenterAt && liveCenterAt < buyMinutesAt, "account items keep their order");
  assert.ok(buyMinutesAt < toolLinksAt && toolLinksAt < signOutAt, "site/tool links follow the account items and Sign out is pinned at the bottom");
  assert.match(header, />Account home</);
  assert.match(header, />API account</);
  assert.match(header, />Live Center</);
  assert.match(header, />Buy minutes</);
  // The header keeps the site's original logo exactly as on main: the
  // approved SVG wordmark at its standing size, never the name as text.
  assert.match(header, /src="\/solvelang-logo\.svg"/);
  assert.match(header, /width=\{194\} height=\{41\}/);
  assert.match(header, /className="h-auto w-32 sm:w-40"/);
  assert.match(header, /aria-label="SolveLang home"/);
  assert.doesNotMatch(header, />SolveLang</);
  // Signed-out access is not lost with the old chip: Sign in leads the menu.
  const signInAt = header.indexOf(">Sign in<");
  assert.notEqual(signInAt, -1);
  assert.ok(signInAt < header.indexOf("primaryLinks.map", signInAt), "Sign in sits above the site links inside the menu for signed-out visitors");
  assert.match(header, /\/customer\/auth\/logout/);
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
  for (const route of ["about", "api-pricing", "check", "repository-audit", "run"]) {
    const page = read(`app/(english)/${route}/page.tsx`);
    assert.doesNotMatch(page, /<SiteHeader|aria-label="SolveLang home"/);
  }
});
test("deployed configuration is not manufactured health evidence", () => {
  assert.equal(observedState(undefined, now), "not_monitored");
  assert.equal(overallState(statusPage.components.map(() => undefined), now), "not_monitored");
  assert.ok(statusPage.components.some((component) => component.monitored));
  assert.ok(statusPage.components.every((component) => component.monitored), "every registered component is wired to a live signal");
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
  assert.equal(overallState(statusPage.components.map((component) => valid[component.id]), now), "operational", "only a complete set of healthy observations supports an all-green claim");
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
  assert.match(read("app/components/homepage/LandingPage.tsx"), /<StatusSummary\s*\/>/);
  assert.doesNotMatch(view, /billingAvailability|accountAvailability|previewAvailability/);
  for (const id of ["account-persistence", "billing", "support", "ci-deployment", "provider-execution", "posthog", "runner-minutes"]) assert.equal(statusPage.components.find((component) => component.id === id).monitored, true, `${id} is live-probed`);
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
  const landing = read("app/components/homepage/LandingPage.tsx");
  assert.match(landing, /import \{ billingAvailability \} from "\.\.\/\.\.\/product-capabilities"/);
  assert.match(landing, /account saving are deployed\. \{billingAvailability\} Paid priority/);
  assert.doesNotMatch(landing, /Billing is enabled for controlled rollout; the first real-payment canary remains pending/);
  assert.match(landing, /Paid priority and general managed execution remain separate gates/);
  assert.match(read("app/(english)/about/page.tsx"), /<ProductCapabilities\s*\/>/);
  for (const page of ["api-pricing/page.tsx", "billing/page.tsx", "pricing/page.tsx"]) assert.match(read(`app/(english)/${page}`), /billingAvailability/);
  assert.match(read("app/(english)/status/status-data.ts"), /Live probe:/);
  assert.match(billingAvailability, /Production API subscription billing/);
  assert.match(billingAvailability, /API plans are purchasable today/);
  assert.doesNotMatch(billingAvailability, /canary is still pending/);
  assert.match(read("app/brandFacts.ts"), /status: "production"/);
  assert.match(read("public/llms.txt"), /Production API subscription billing and checkout are live/);
  assert.equal(capabilityGroups.find((group) => group.id === "billing").description, billingAvailability);
  for (const page of ["about", "api-pricing"]) assert.doesNotMatch(read(`app/(english)/${page}/page.tsx`), /Test-mode API access, account|only in the protected SolveLang test environment/);
});

test("homepage renders its sections from the shared component and landing is not a route", () => {
  const homepage = read("app/(english)/page.tsx");
  const landing = read("app/components/homepage/LandingPage.tsx");
  assert.match(homepage, /import LandingPage from "\.\.\/components\/homepage\/LandingPage";/);
  const sections = ["<InteractiveHero />", "id=\"boundaries\"", "id=\"capabilities\"", "id=\"studio\"", "id=\"solve-context\"", "id=\"evidence\"", "className={styles.builtBand}", "id=\"quickstart\"", "className={styles.finalSection}"];
  let previous = -1;
  for (const section of sections) { const index = landing.indexOf(section); assert.ok(index > previous, `${section} follows the previous section`); previous = index; }
  assert.equal(existsSync(new URL("../app/(english)/landing", import.meta.url)), false);
  assert.equal(existsSync(new URL("../app/(english)/landing/page.tsx", import.meta.url)), false);
});

const {
  QUEUE_CARDS,
  BREAKER_ID,
  BATCH_LABEL,
  BREAK_BANNER,
  ISOLATE_BANNER,
  MERGE_BANNER,
  BEAT_BANNERS,
  DESKTOP_TIMELINE,
  MOBILE_TIMELINE,
  phaseAt,
  SEQUENCE_DESCRIPTION,
} = require("../.studio-test-dist/public-site/(english)/process-solution/queue-animation.js");
const queueComponent = read("app/(english)/process-solution/QueueAnimation.tsx");
const queueCss = read("app/(english)/process-solution/QueueAnimation.module.css");
const queueEngine = read("app/(english)/process-solution/queue-animation.ts");

test("queue animation tells only the brief's story, with generic PR titles", () => {
  assert.deepEqual(
    QUEUE_CARDS.map((card) => card.title),
    ["feat/auth-retry", "fix/cache-ttl", "chore/deps-bump", "feat/export-csv"],
  );
  const breaker = QUEUE_CARDS.find((card) => card.id === BREAKER_ID);
  assert.equal(breaker?.title, "fix/cache-ttl");
  assert.equal(breaker?.breaker, true);
  assert.equal(QUEUE_CARDS.filter((card) => card.breaker).length, 1);
  assert.equal(BATCH_LABEL, "Combined tree — testing together");
  assert.equal(BREAK_BANNER, "Combined check failed.");
  assert.equal(ISOLATE_BANNER, "Breaker isolated — returned to its author.");
  assert.equal(MERGE_BANNER, "Main stayed green.");
  assert.equal(BEAT_BANNERS.hold, MERGE_BANNER);
  assert.ok(SEQUENCE_DESCRIPTION.length > 40);
});

test("queue timelines stay inside the shared loop budget", () => {
  for (const timeline of [DESKTOP_TIMELINE, MOBILE_TIMELINE]) {
    assert.ok(timeline.totalMs >= 9_000 && timeline.totalMs <= 14_000, `${timeline.variant} total ${timeline.totalMs}`);
    assert.ok(timeline.holdMs >= 1_500, `${timeline.variant} hold ${timeline.holdMs}`);
    assert.equal(timeline.beats[0].startMs, 0);
    assert.equal(timeline.beats[timeline.beats.length - 1].endMs, timeline.totalMs);
    for (let i = 1; i < timeline.beats.length; i += 1) {
      assert.equal(timeline.beats[i].startMs, timeline.beats[i - 1].endMs, `${timeline.variant} beat ${i} is contiguous`);
    }
    assert.deepEqual(
      timeline.beats.map((beat) => beat.id),
      ["queue", "batch", "break", "bisect", "isolate", "merge", "hold"],
    );
  }
  assert.ok(MOBILE_TIMELINE.totalMs < DESKTOP_TIMELINE.totalMs, "mobile loop is the calm, shortened one");
  assert.equal(MOBILE_TIMELINE.secondSplitAt, null, "mobile performs a single bisect split");
  assert.ok(DESKTOP_TIMELINE.secondSplitAt !== null && DESKTOP_TIMELINE.secondSplitAt > 0 && DESKTOP_TIMELINE.secondSplitAt < 1);
});

test("phaseAt walks every beat in order, reports the beat banner, and wraps", () => {
  for (const [variant, timeline] of [["desktop", DESKTOP_TIMELINE], ["mobile", MOBILE_TIMELINE]]) {
    const seen = [];
    for (let t = 0; t < timeline.totalMs; t += 50) {
      const phase = phaseAt(t, variant);
      assert.equal(phase.banner, BEAT_BANNERS[phase.beat]);
      assert.ok(phase.progress >= 0 && phase.progress <= 1);
      assert.ok(phase.cycleMs >= 0 && phase.cycleMs < timeline.totalMs);
      if (seen[seen.length - 1] !== phase.beat) seen.push(phase.beat);
    }
    assert.deepEqual(seen, ["queue", "batch", "break", "bisect", "isolate", "merge", "hold"]);
    assert.equal(phaseAt(timeline.totalMs + 100, variant).beat, phaseAt(100, variant).beat);
    assert.equal(phaseAt(-100, variant).cycleMs, phaseAt(timeline.totalMs - 100, variant).cycleMs);
  }
  const desktopBisectMid = DESKTOP_TIMELINE.beats.find((beat) => beat.id === "bisect");
  const beforeSecondSplit = phaseAt(desktopBisectMid.startMs + 10, "desktop");
  const afterSecondSplit = phaseAt(desktopBisectMid.endMs - 10, "desktop");
  assert.equal(beforeSecondSplit.secondSplit, false);
  assert.equal(afterSecondSplit.secondSplit, true);
});

test("queue component honours the motion, pause, and accessibility contracts", () => {
  assert.match(queueComponent, /IntersectionObserver/);
  assert.match(queueComponent, /visibilitychange/);
  assert.match(queueComponent, /prefers-reduced-motion: reduce/);
  assert.match(queueComponent, /role="img"/);
  assert.match(queueComponent, /aria-hidden="true"/);
  assert.match(queueComponent, /sr-only/);
  assert.match(queueComponent, /h-\[448px\]/);
  assert.match(queueComponent, /sm:h-\[468px\]/);
  assert.match(queueCss, /transition-property: transform, opacity/);
  const keyframeBodies = [...queueCss.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/g)].map((match) => match[1]);
  assert.ok(keyframeBodies.length >= 1, "the shimmer keyframes exist");
  for (const body of keyframeBodies) {
    const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
    assert.ok(properties.length >= 1, "keyframes declare at least one property");
    for (const property of properties) {
      assert.ok(property === "transform" || property === "opacity", `keyframe animates ${property}`);
    }
  }
  assert.match(queueCss, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(queueEngine, /document\.|window\.|requestAnimationFrame/);
  for (const source of [queueComponent, queueEngine]) {
    assert.doesNotMatch(source, /upcomingsounds/i);
    assert.doesNotMatch(source, /saiidz/);
  }
});

test("process solution hero pairs the headline with the queue animation", () => {
  const page = read("app/(english)/process-solution/page.tsx");
  assert.match(page, /import QueueAnimation from "\.\/QueueAnimation";/);
  assert.match(page, /<QueueAnimation \/>/);
  assert.match(page, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,430px\)\]/);
  assert.match(page, /Become a design partner/);
  assert.match(page, /hello@solve-lang\.com/);
});
test("services page publishes the full service list with live and pilot labels", () => {
  const page = read("app/(english)/services/page.tsx");
  assert.match(page, /Runner Minutes/);
  assert.match(page, /Zero-step onboarding/);
  assert.match(page, /Label routing/);
  for (const price of ["$20", "$100", "$400", "$80", "$140", "$192", "$236", "$275", "$306", "$336", "$360", "$382.50"]) {
    assert.ok(page.includes(price), `services page lists the ${price} shelf price`);
  }
  for (const minutes of ["5,000", "25,000", "100,000", "1,000", "10,000"]) {
    assert.ok(page.includes(minutes), `services page lists the ${minutes}-minute pack`);
  }
  assert.match(page, /solvelang-runners-standard/);
  assert.match(page, /solvelang-runners-high-power/);
  assert.match(page, /\/account\/runner-minutes-checkout\//);
  assert.match(page, /Fix it yourself/, "services page offers the fix-it-yourself help line");
  assert.match(page, /href="\/solutions\/"/, "services page links the solutions library");
  assert.doesNotMatch(page, /buy\.stripe\.com/);
  assert.match(page, /API access plans/);
  assert.ok(page.includes("$49") && page.includes("$199") && page.includes("$699"));
  assert.match(page, /\/api-pricing\//);
  assert.match(page, /Merge governance/);
  assert.match(page, /Pilot status:/);
  assert.match(page, /no public price and no self-serve signup/);
  assert.match(page, /\/process-solution\//);
});

test("services page publishes runner-minutes Product and FAQ schema built from its own shelf", () => {
  const page = read("app/(english)/services/page.tsx");
  assert.match(page, /"@type": "Product"/);
  assert.match(page, /SolveLang Runner Minutes/);
  assert.match(page, /standardPacks\.map/, "schema offers are generated from the visible Standard table");
  assert.match(page, /highPowerPacks\.map/, "schema offers are generated from the visible High-Power table");
  assert.match(page, /id="services-runner-minutes-json-ld"/);
  assert.match(page, /"@type": "FAQPage"/);
  assert.match(page, /id="services-faq-json-ld"/);
  assert.match(page, /How are runner minutes metered\?/);
  assert.match(page, /Is faster processing free\?/);
  assert.match(page, /Where do I buy runner minutes\?/);
});

test("services route is registered for the sitemap and linked in primary navigation", () => {
  assert.match(read("app/i18n/routes.ts"), /segment: "services"[^\n]+sitemap: true/);
  assert.ok(primaryLinks.some((link) => link.href === "/services/"), "primary navigation links to /services/");
});

test("process solution page is labeled a pilot with no public price", () => {
  const page = read("app/(english)/process-solution/page.tsx");
  assert.match(page, />Pilot</);
  assert.match(page, /Pilot status:/);
  assert.match(page, /no public price and no self-serve signup yet/);
});

test("api pricing page carries the runner minutes shelf summary", () => {
  const page = read("app/(english)/api-pricing/page.tsx");
  assert.match(page, /Runner minutes · Live/);
  assert.match(page, /5,000 minutes \$20/);
  assert.match(page, /\/services\//);
  assert.match(page, /\/account\/runner-minutes-checkout\//);
});

test("api pricing page publishes API plan and runner-minutes schema", () => {
  const page = read("app/(english)/api-pricing/page.tsx");
  assert.match(page, /"@type": "Product"/);
  assert.match(page, /SolveLang API Access Plans/);
  assert.match(page, /plans\.map/, "API plan offers are generated from the visible plans table");
  assert.match(page, /id="api-plans-json-ld"/);
  assert.match(page, /"@type": "AggregateOffer"/);
  assert.match(page, /lowPrice: "80"/);
  assert.match(page, /highPrice: "400"/);
  assert.match(page, /id="api-pricing-runner-minutes-json-ld"/);
  assert.match(page, /"@type": "FAQPage"/);
  assert.match(page, /id="api-pricing-faq-json-ld"/);
  assert.match(page, /What does one API credit cover\?/);
});

test("runner minutes checkout points at the live service by default", () => {
  const component = read("app/account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout.tsx");
  assert.match(component, /NEXT_PUBLIC_RUNNER_MINUTES_BASE_URL \|\| "https:\/\/runners\.solve-lang\.com"/);
});

test("runner minutes checkout terms state the GitHub fee is absorbed, never passed through", () => {
  const checkout = read("app/account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout.tsx");
  // Standing product decision (Nov 13, 2026): if GitHub's announced
  // $0.002/min self-hosted runner fee ever takes effect, SolveLang absorbs
  // it. The terms line must say so, and must never again claim the fee is
  // passed through to the customer.
  assert.match(checkout, /\$0\.002 per minute fee for self-hosted runners/);
  assert.match(checkout, /SolveLang absorbs it — it is never passed through to you/);
  assert.doesNotMatch(checkout, /passed through at cost/);
});

test("runner minutes checkout carries an optional verification code in the payment action area", () => {
  const checkout = read("app/account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout.tsx");
  // The field exists, in plain language, wired to its own state.
  assert.match(checkout, /Have a verification code\?/);
  assert.match(checkout, /id="runner-minutes-verification-code"/);
  assert.match(checkout, /const \[verificationCode, setVerificationCode\] = useState\(""\);/);
  // It lives with the payment action: it follows the not-configured
  // notice in the source (so it renders only in the configured branch,
  // never where the notice sits) and precedes the payment button.
  const noticeAt = checkout.indexOf("Runner Minutes checkout is being switched on.");
  const fieldAt = checkout.indexOf('id="runner-minutes-verification-code"');
  const buttonAt = checkout.indexOf("Continue to payment");
  assert.ok(noticeAt !== -1 && fieldAt > noticeAt, "code field sits in the configured payment branch, after the notice");
  assert.ok(fieldAt !== -1 && buttonAt !== -1 && fieldAt < buttonAt, "code field precedes the payment button");
});

test("runner minutes verification code is sent only when entered and never reaches Stripe", () => {
  const checkout = read("app/account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout.tsx");
  const start = checkout.slice(checkout.indexOf("async function startPayment()"), checkout.indexOf("async function confirmPayment()"));
  // With no code entered, the request body is exactly the old shape.
  assert.match(start, /: \{ pack: pack\.key, requestId \}/);
  // An entered code rides along under its own field name.
  assert.match(start, /verificationCode: trimmedCode/);
  // The verification branch is answered before Stripe is ever loaded,
  // and lands on the verified success phase.
  const branchAt = start.indexOf("isVerificationCheckoutResponse(result)");
  const stripeAt = start.indexOf("loadStripe(");
  assert.ok(branchAt !== -1 && stripeAt !== -1 && branchAt < stripeAt, "verification is answered before loadStripe");
  assert.match(start, /setPhase\("verified-done"\)/);
  // The guard is strict: a true verification marker at amountCents 0.
  assert.match(checkout, /result\.verification === true && result\.amountCents === 0/);
});

test("runner minutes verified success shows $0.00 and the credited minutes, and the paid path copy is untouched", () => {
  const checkout = read("app/account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout.tsx");
  assert.match(checkout, /Verification code accepted/);
  assert.match(checkout, /dollars\(verified\.amountCents\)/);
  assert.match(checkout, /minutes are credited to your account balance/);
  // No-code behaviour is unchanged: the Elements session is still
  // required, and the not-configured notice still reads as before.
  assert.match(checkout, /if \(!result\.clientSecret \|\| !result\.publishableKey\) throw new Error\("Stripe checkout did not return a secure payment session\."\);/);
  assert.match(checkout, /Runner Minutes checkout is being switched on\. The packs and prices above are final/);
});

test("runner minutes buy page shows the selection and the honest not-yet-on state at the point of selection", () => {
  const checkout = read("app/account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout.tsx");
  // The header copy branches on the configuration state: only the
  // configured copy may promise the Stripe payment form.
  assert.match(checkout, /\{CHECKOUT_CONFIGURED \? \(/);
  assert.match(checkout, /Payment is not switched on yet: when sales open, it switches on right here on this page/);
  // In the unconfigured block, the selection echo sits directly above the
  // switched-on notice, and the block renders no button at all — the
  // honest message is the state, never a fake disabled Continue.
  const start = checkout.indexOf("{!CHECKOUT_CONFIGURED ? (");
  assert.ok(start >= 0, "the unconfigured selection block exists");
  const block = checkout.slice(start, checkout.indexOf(") : (", start));
  const echoAt = block.indexOf("Selected:");
  const noticeAt = block.indexOf("Runner Minutes checkout is being switched on");
  assert.ok(echoAt >= 0 && noticeAt > echoAt, "the selection echo sits directly above the switched-on notice");
  assert.match(block, /\{pack\.label\} — \$\{pack\.totalDollars\}/);
  assert.doesNotMatch(block, /<button/);
  // Continue to payment exists exactly once — inside the configured
  // branch — and starting payment stays impossible while unconfigured.
  assert.equal(checkout.split("Continue to payment").length - 1, 1);
  assert.match(checkout, /if \(!account \|\| phase === "creating" \|\| !CHECKOUT_CONFIGURED\) return;/);
});

test("runner minutes checkout carries the pause and start control with the paused message", () => {
  const checkout = read("app/account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout.tsx");
  // The minutes account is read from the runners service with the same
  // session-authenticated customer pattern as the purchase call.
  assert.match(checkout, /"\/customer\/runner-minutes\/account"/);
  // The status semantics, the pause/resume endpoints, the toggle
  // label, and the paused line live in the shared core module — the
  // account home's Runner minutes card folds the same control in
  // through those helpers, so the two surfaces cannot drift.
  const account = read("app/account/core/runner-minutes-account.ts");
  assert.match(checkout, /from "@\/app\/account\/core\/runner-minutes-account"/);
  assert.match(account, /export type RunnerMinutesStatus = "active" \| "paused";/);
  assert.match(account, /return account\.status === "paused" \? "paused" : "active";/);
  assert.match(account, /"\/customer\/runner-minutes\/pause" \| "\/customer\/runner-minutes\/resume"/);
  assert.match(account, /status === "paused" \? "\/customer\/runner-minutes\/resume" : "\/customer\/runner-minutes\/pause";/);
  assert.match(account, /status === "paused" \? "Start minutes" : "Pause minutes";/);
  assert.match(account, /Your minutes are paused — jobs will not run and no minutes will be used\./);
  // The control offers Pause while active and Start while paused, and
  // the paused state carries the plain-language line verbatim.
  assert.match(checkout, /\{runnerMinutesToggleLabel\(minutesStatus\)\}/);
  assert.match(checkout, /\{RUNNER_MINUTES_PAUSED_LINE\}/);
  // Toggling posts to the matching endpoint with the account CSRF
  // token, then re-reads the account and renders the reported state.
  const toggle = checkout.slice(checkout.indexOf("async function toggleMinutes()"), checkout.indexOf("useEffect(() => {"));
  assert.match(toggle, /runnerMinutesTogglePath\(minutesStatus\)/);
  assert.match(toggle, /method: "POST", csrfToken: account\.csrfToken/);
  assert.match(toggle, /setMinutesStatus\(await loadRunnerMinutesStatus\(\)\)/);
  assert.match(toggle, /setMinutesError\(caught instanceof Error \? caught\.message/);
  // Pausing never disables buying: the purchase controls carry no
  // minutes-status disable and Continue to payment still exists once.
  assert.doesNotMatch(checkout, /disabled=\{minutesStatus/);
  assert.equal(checkout.split("Continue to payment").length - 1, 1);
});

test("account home runner minutes card carries the same pause and start control", () => {
  const home = read("app/account/home/AccountHome.tsx");
  // The card consumes the same shared core helpers as the checkout
  // control — one implementation, two surfaces.
  assert.match(home, /from "@\/app\/account\/core\/runner-minutes-account"/);
  // The account read resolves the reported status through the shared
  // resolver, and the status display mirrors the checkout control's.
  assert.match(home, /setMinutesStatus\(runnerMinutesStatus\(view\)\)/);
  assert.match(home, /Runner minutes: \{minutesStatus === "paused" \? "Paused" : "Active"\}/);
  // The control offers Pause while active and Start while paused, and
  // the paused state carries the shared plain-language line verbatim.
  assert.match(home, /\{runnerMinutesToggleLabel\(minutesStatus\)\}/);
  assert.match(home, /\{RUNNER_MINUTES_PAUSED_LINE\}/);
  // Toggling posts through the shared endpoint helper with the
  // account CSRF token, then re-reads the account and renders the
  // reported state — the same discipline as the checkout control.
  const toggle = home.slice(home.indexOf("async function toggleMinutes()"), home.indexOf('if (screen === "loading")'));
  assert.match(toggle, /runnerMinutesTogglePath\(minutesStatus\)/);
  assert.match(toggle, /method: "POST", csrfToken: dashboard\.csrfToken/);
  assert.match(toggle, /setMinutesStatus\(runnerMinutesStatus\(view\)\)/);
  assert.match(toggle, /setMinutesError\(caught instanceof Error \? caught\.message/);
  // The control renders only once the balance read has reported, so
  // the card never offers a toggle on a guessed state.
  assert.match(home, /\{balanceState === "ready" && minutes \? \(/);
});

test("live center overview carries the queue panel with per-PR progress rows", () => {
  const board = read("app/account/live-center/LiveCenterBoard.tsx");
  assert.match(board, /The queue/);
  assert.match(board, /board\.pullRequests\.slice\(0, 25\)/);
  assert.match(board, /showPosition \/>/);
});

test("the runners view renders the registered fleet when the payload carries it", () => {
  const runs = read("app/account/live-center/LiveCenterRuns.tsx");
  assert.match(runs, /Your full runner fleet/);
  assert.match(runs, /board\.fleet\.available/);
  assert.match(runs, /board\.fleet\.runners\.map/);
  assert.match(runs, /Repository Administration, read-only/);
});

test("account home page exists and carries the three account cards", () => {
  const page = read("app/(english)/account/page.tsx");
  // The bare /account/ address is a real page now, noindexed like its
  // sibling account pages, rendering the account home component.
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /<AccountHome \/>/);
  const home = read("app/account/home/AccountHome.tsx");
  // All three cards are there, with their exact destinations.
  assert.match(home, />API account</);
  assert.match(home, /href="\/account\/api-keys\/"/);
  assert.match(home, />Live Center</);
  assert.match(home, /href="\/account\/live-center\/"/);
  assert.match(home, />Runner minutes</);
  assert.match(home, /href="\/account\/runner-minutes-checkout\/"/);
  assert.match(home, /Buy a minutes pack/);
  // The session gate is the same account read every account page makes.
  assert.match(home, /"\/customer\/account"/);
  // The balance is the same Runner Minutes account read the checkout
  // page makes — same endpoint, same default service address and
  // override — and it is never guessed when the read fails.
  assert.match(home, /"\/customer\/runner-minutes\/account"/);
  assert.match(home, /NEXT_PUBLIC_RUNNER_MINUTES_BASE_URL \|\| "https:\/\/runners\.solve-lang\.com"/);
  assert.match(home, /could not load your balance/i);
});

test("a dead sign-in link explains itself instead of failing silently", () => {
  const page = read("app/(english)/account/api-keys/page.tsx");
  assert.match(page, /That sign-in link is invalid or expired — request a fresh one below\./);
  // The message is set on the verify-failure path of the magic-token
  // branch, and the hash is cleared there too — the plain no-token load
  // never reaches this branch and keeps swallowing 401s in silence.
  const start = page.indexOf("const token = magicTokenFromHash");
  assert.ok(start >= 0, "the magic-token branch exists");
  const tokenBranch = page.slice(start, page.indexOf('"/customer/account"', start));
  assert.match(tokenBranch, /\/customer\/auth\/verify/);
  assert.match(tokenBranch, /setError\("That sign-in link is invalid or expired/);
  assert.match(tokenBranch, /window\.history\.replaceState/);
  assert.match(page, /apiError\.status !== 401/);
});

test("sign-in buttons wait for the bot check only when it is configured", () => {
  const page = read("app/(english)/account/api-keys/page.tsx");
  const botCheck = read("app/account/core/signin-bot-check.tsx");
  assert.match(botCheck, /export const signInTurnstileConfigured = turnstileSiteKey\.length > 0;/);
  // Both submit buttons gate on the same derived flag, and each gated
  // form carries the plain hint line exactly once.
  assert.match(page, /const botCheckPending = signInTurnstileConfigured && !turnstileToken;/);
  assert.equal((page.match(/disabled=\{busy \|\| botCheckPending\}/g) || []).length, 2);
  assert.equal((page.match(/Complete the quick check above, then this button turns on\./g) || []).length, 2);
});

test("a dead sign-in link never decides the screen by itself", () => {
  const page = read("app/(english)/account/api-keys/page.tsx");
  // The verify-failure branch sets the explanation and nothing
  // else: the session read after it decides between the dashboard
  // and the sign-in form, so a signed-in visitor who opens a used
  // link keeps their session (and sees the banner on it).
  const start = page.indexOf("if (verifyFailed || !result)");
  assert.ok(start >= 0, "the verify-failure branch exists");
  const failureBranch = page.slice(start, page.indexOf("else if (result.mfaRequired", start));
  assert.match(failureBranch, /setError\("That sign-in link is invalid or expired/);
  assert.doesNotMatch(failureBranch, /setScreen\(/);
  assert.doesNotMatch(failureBranch, /return;/);
  // The session read still follows the token branch.
  assert.ok(page.indexOf('"/customer/account"', start) > start);
});

test("each sign-in button shows busy only for its own form", () => {
  const page = read("app/(english)/account/api-keys/page.tsx");
  assert.match(page, /const \[busyForm, setBusyForm\] = useState<"password" \| "link" \| null>\(null\);/);
  assert.match(page, /\{busyForm === "password" \? "Signing in\u2026" : "Sign in"\}/);
  assert.match(page, /\{busyForm === "link" \? "Sending\u2026" : "Email me a sign-in link"\}/);
  assert.doesNotMatch(page, /\{busy \? "Signing in\u2026"/);
  assert.doesNotMatch(page, /\{busy \? "Sending\u2026"/);
  // Each submit handler marks its own form and clears the mark in
  // its finally block.
  const passwordLogin = page.slice(page.indexOf("async function passwordLogin"), page.indexOf("async function verifyMfa"));
  assert.match(passwordLogin, /setBusyForm\("password"\)/);
  assert.match(passwordLogin, /setBusyForm\(null\)/);
  const requestLink = page.slice(page.indexOf("async function requestLink"), page.indexOf("async function saveCredentials"));
  assert.match(requestLink, /setBusyForm\("link"\)/);
  assert.match(requestLink, /setBusyForm\(null\)/);
});

test("signed-out account home sends visitors to the real sign-in page", () => {
  const home = read("app/account/home/AccountHome.tsx");
  // A 401 from the session read is proof of signed-out: the visitor
  // is sent to the full sign-in page instead of the bare two-link
  // gate. Any other failure keeps the gate, with its error showing.
  const gate = home.slice(home.indexOf("async function prepare()"), home.indexOf("async function toggleMinutes()"));
  assert.match(gate, /apiError\?\.status === 401/);
  assert.match(gate, /window\.location\.replace\("\/account\/api-keys\/"\)/);
  assert.match(gate, /setScreen\("signed-out"\)/);
});

const {
  STUDIO_DWELL_MS,
  STUDIO_START_MS,
  REVEAL_SWEEP_LINE,
  clamp01,
  pinProgress,
  traversalProgress,
  warmth,
  revealDue,
  heroParallax,
  flowPaint,
} = require("../.studio-test-dist/public-site/components/homepage/animation.js");
const landingAnimation = read("app/components/homepage/LandingAnimation.tsx");
const landingAnimCss = read("app/components/homepage/animation.module.css");
const landingAnimEngine = read("app/components/homepage/animation.ts");
const landingPage = read("app/components/homepage/LandingPage.tsx");
const landingCss = read("app/components/homepage/landing.module.css");

test("homepage animation math: pin and traversal progress clamp to the frame", () => {
  assert.equal(pinProgress(10, 1900, 1000), 0);
  assert.equal(pinProgress(0, 1900, 1000), 0);
  assert.equal(pinProgress(-450, 1900, 1000), 0.5);
  assert.equal(pinProgress(-900, 1900, 1000), 1);
  assert.equal(pinProgress(-5000, 1900, 1000), 1);
  assert.equal(traversalProgress(1000, 800, 1000), 0);
  assert.equal(traversalProgress(100, 800, 1000), 0.5);
  assert.equal(traversalProgress(-800, 800, 1000), 1);
  assert.equal(clamp01(Number.NaN), 0);
  assert.equal(clamp01(-2), 0);
  assert.equal(clamp01(2), 1);
});

test("homepage animation math: context stages warm continuously in quarters", () => {
  assert.deepEqual(warmth(0, 0), { opacity: 0.35, arrived: false });
  assert.equal(warmth(0.25, 0).arrived, true);
  assert.equal(warmth(0.25, 1).opacity, 0.35);
  assert.ok(Math.abs(warmth(0.5, 1).opacity - 1) < 1e-9);
  assert.equal(warmth(0.5, 2).opacity, 0.35);
  assert.equal(warmth(1, 3).arrived, true);
  for (let i = 0; i < 4; i += 1) assert.equal(warmth(1, i).opacity, 1);
});

test("homepage animation math: sweep line, parallax cap, studio pacing, flow beats", () => {
  assert.equal(REVEAL_SWEEP_LINE, 0.85);
  assert.equal(revealDue(849, 1000), true);
  assert.equal(revealDue(850, 1000), false);
  assert.equal(heroParallax(0), 0);
  assert.equal(heroParallax(100), 5);
  assert.equal(heroParallax(100000), 18);
  assert.equal(STUDIO_DWELL_MS, 1600);
  assert.equal(STUDIO_START_MS, 900);
  assert.deepEqual(flowPaint(0), { activeNode: 0, doneNodes: [], activeConnector: -1, doneConnectors: [], activePathStep: 0 });
  assert.deepEqual(flowPaint(1), { activeNode: 0, doneNodes: [], activeConnector: 0, doneConnectors: [], activePathStep: 0 });
  assert.deepEqual(flowPaint(2), { activeNode: 1, doneNodes: [0], activeConnector: -1, doneConnectors: [0], activePathStep: 1 });
  assert.deepEqual(flowPaint(3), { activeNode: 1, doneNodes: [0], activeConnector: 1, doneConnectors: [0], activePathStep: 1 });
  assert.deepEqual(flowPaint(4), { activeNode: 2, doneNodes: [0, 1], activeConnector: -1, doneConnectors: [0, 1], activePathStep: 2 });
});

test("homepage animation: hidden states exist only behind the JS-armed gate", () => {
  const hiddenRules = landingAnimCss
    .split("}")
    .filter((rule) => /opacity:\s*0/.test(rule) && /\[data-(reveal|scale|hero-line)\]/.test(rule));
  assert.ok(hiddenRules.length >= 3, "reveal, scale and hero-line pre-states exist");
  for (const rule of hiddenRules) assert.match(rule, /\[data-landing-anim="armed"\]/);
  assert.match(landingAnimation, /dataset\.landingAnim = "armed"/);
  assert.match(landingAnimation, /useLayoutEffect/);
  /* the page is wrapped by the orchestrator, so arming covers every section */
  assert.match(landingPage, /<LandingAnimation className="bg-\[#f5f6f4\] text-\[#102036\]">/);
  assert.match(landingPage, /<\/LandingAnimation>/);
});

test("homepage animation: observers, sweep fallback, and reduced-motion finish", () => {
  assert.match(landingAnimation, /new IntersectionObserver/);
  assert.match(landingAnimation, /window\.setTimeout\(sweep, 1500\)/);
  assert.match(landingAnimation, /revealDue\(el\.getBoundingClientRect\(\)\.top, vh\)/);
  assert.match(landingAnimation, /prefers-reduced-motion: reduce/);
  assert.match(landingAnimation, /visibilitychange/);
  const reduced = landingAnimCss.slice(landingAnimCss.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\[data-reveal\][^}]*opacity: 1 !important/);
  assert.match(reduced, /\[data-hero-line\]/);
  assert.match(reduced, /\.scProgress i \{ transform: scaleX\(1\) !important; \}/);
  assert.match(reduced, /\.ctaGlow \{ display: none !important; \}/);
  assert.match(landingCss, /prefers-reduced-motion: reduce/);
});

test("homepage animation: only transform and opacity animate (plus studio emphasis)", () => {
  const keyframeBodies = [...landingAnimCss.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/g)].map((match) => match[1]);
  assert.ok(keyframeBodies.length >= 2, "the hero rise and CTA glow keyframes exist");
  for (const body of keyframeBodies) {
    const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
    assert.ok(properties.length >= 1, "keyframes declare at least one property");
    for (const property of properties) {
      assert.ok(property === "transform" || property === "opacity", `keyframe animates ${property}`);
    }
  }
  const transitions = [...landingAnimCss.matchAll(/transition:[^;]+/g)].map((match) => match[0]);
  assert.ok(transitions.length >= 5, "the reveal and walkthrough transitions exist");
  for (const declaration of transitions) {
    assert.doesNotMatch(declaration, /\b(width|height|top|left|right|bottom|margin|padding|gap|font-size)\b/);
  }
  const drift = landingCss.slice(landingCss.indexOf("@keyframes heroGlowDrift"), landingCss.indexOf("@keyframes heroGlowDrift") + 220);
  assert.match(drift, /transform: translate3d/);
  assert.doesNotMatch(drift, /\b(width|height|top|left)\s*:/);
  assert.doesNotMatch(landingAnimEngine, /document\.|window\.|requestAnimationFrame/);
});

test("homepage animation: solve context pin structure and continuous progress", () => {
  assert.match(landingAnimCss, /\.scPinWrap \{ background: #eaf0f3; \}/);
  assert.match(landingAnimCss, /\.scPinWrap \{ height: 190vh; position: relative; \}/);
  assert.match(landingAnimCss, /\.scPin \{ position: sticky; top: 0; min-height: 100vh;/);
  assert.match(landingAnimation, /pinProgress\(rect\.top, rect\.height, window\.innerHeight\)/);
  assert.match(landingAnimation, /warmth\(progress, Number\(el\.dataset\.scStep/);
  assert.match(landingAnimation, /matchMedia\("\(min-width: 960px\) and \(min-height: 720px\)"\)/);
  assert.match(landingPage, /data-sc-wrap=""/);
  assert.match(landingPage, /data-sc-bar=""/);
  assert.equal((landingPage.match(/data-sc-chip="/g) || []).length, 4);
  assert.match(landingPage, /data-sc-step=\{index\}/);
});

test("homepage animation: studio hooks and light-section heading contrast", () => {
  assert.equal((landingPage.match(/data-flow-node/g) || []).length, 3);
  assert.equal((landingPage.match(/data-flow-conn/g) || []).length, 2);
  assert.equal((landingPage.match(/data-tp=""/g) || []).length, 3);
  assert.equal((landingPage.match(/data-action=""/g) || []).length, 1);
  assert.match(landingPage, /data-studio-panel=""/);
  assert.match(landingPage, /data-studio-actions=""/);
  assert.match(landingAnimation, /STUDIO_DWELL_MS/);
  /* light sections inherit the root's dark ink; none of their h2s re-lightens */
  const context = landingPage.slice(landingPage.indexOf('id="solve-context"'), landingPage.indexOf('id="evidence"'));
  assert.doesNotMatch(context.match(/<h2[^>]*>/)?.[0] ?? "", /text-white/);
  assert.match(context, /bg-\[#eaf0f3\]/);
  const capabilities = landingPage.slice(landingPage.indexOf('id="capabilities"'), landingPage.indexOf('id="studio"'));
  assert.doesNotMatch(capabilities.match(/<h2[^>]*>/)?.[0] ?? "", /text-white/);
  const quickstart = landingPage.slice(landingPage.indexOf('id="quickstart"'));
  assert.doesNotMatch(quickstart.match(/<h2[^>]*>/)?.[0] ?? "", /text-white/);
});

test("account layout exists, detects the session like the account menu, and renders the sidebar only when signed in", () => {
  const layout = read("app/(english)/account/layout.tsx");
  // Same client-side session detection as SiteAccountMenu: no server
  // session exists, so the layout asks the customer API directly.
  assert.match(layout, /customerApi<CustomerDashboard>\(API_BASE, "\/customer\/account", \{ method: "GET" \}\)/);
  assert.match(layout, /customerSessionChangedEvent/);
  assert.match(layout, /caught\.status === 401 \? "signed-out" : "unavailable"/);
  // Signed out (and loading/unavailable) renders children exactly as
  // before: no shell, no sidebar, no visual change.
  assert.match(layout, /if \(sessionState !== "signed-in"\) \{\n    return <>\{children\}<\/>;\n  \}/);
  // Signed in renders the shared sidebar component inside the shell.
  assert.match(layout, /data-account-shell="signed-in"/);
  assert.match(layout, /<AccountSidebar className="order-1" \/>/);
  assert.match(read("app/components/AccountSidebar.tsx"), /data-account-sidebar="true"/);
});

test("account sidebar carries both approved groups in order with exact plain-line targets", () => {
  const sidebar = read("app/components/AccountSidebar.tsx");
  assert.match(sidebar, /\{group\.head\}/);
  assert.match(sidebar, /head: "Your account", entries: ACCOUNT_ENTRIES/);
  assert.match(sidebar, /head: "Work", entries: WORK_ENTRIES/);
  const hrefs = [...sidebar.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, [
    "/account/",
    "/account/api-keys/",
    "/account/live-center/",
    "/account/live-center/",
    "/account/api-keys/#sign-in-security",
    "/studio/",
    "/check/",
    "/repository-audit/",
    "/server-audit/",
    "/audit/",
    "/run/",
    "/process-solution/",
  ]);
  const labels = [...sidebar.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, [
    "Account home",
    "API account",
    "Live Center",
    "Runner minutes",
    "Sign-in & security",
    "Studio",
    "Workflow check",
    "Repository audit",
    "Server audit",
    "Audit",
    "Run in browser",
    "Process Solution",
  ]);
  // Plain single lines only: no sub-caption field, no sub rendering,
  // and no Buy minutes entry in the sidebar at all.
  assert.doesNotMatch(sidebar, /sub: "|entry\.sub|buy-minutes|label: "Buy minutes"/);
  // Runner minutes is not deep-linkable: the Live Center board keeps
  // its tab in internal state, so the entry links to the Live Center.
  assert.match(sidebar, /Minutes view is not deep-linkable|not deep-linkable/);
  const board = read("app/account/live-center/LiveCenterBoard.tsx");
  assert.match(board, /const \[tab, setTab\] = useState<TabId>\("overview"\)/);
  assert.doesNotMatch(board, /searchParams|URLSearchParams/);
});

test("sidebar active state follows the current page across both groups", () => {
  const sidebar = read("app/components/AccountSidebar.tsx");
  // Every Work entry matches its own route prefix; account entries
  // match only /account routes, so a tool page can never falsely
  // highlight an account entry (and vice versa).
  for (const target of ["/studio", "/check", "/repository-audit", "/server-audit", "/audit", "/run", "/process-solution"]) {
    assert.ok(sidebar.includes("onPath(" + JSON.stringify(target) + ")"), target);
  }
  assert.match(sidebar, /aria-current=\{active \? "page" : undefined\}/);
  // /audit/ carries its own Work entry (owner order Nov 14, 2026):
  // it appears as a target with its own active mapping.
  assert.match(sidebar, /href: "\/audit\/"/);
  assert.match(sidebar, /onPath\("\/audit"\)/);
});

test("account sidebar is a full-height left column attached to the edge, and a wrapping strip on phones", () => {
  const layout = read("app/(english)/account/layout.tsx");
  const sidebar = read("app/components/AccountSidebar.tsx");
  // Edge-attached shell: the sidebar is first (left), the content
  // second; the row stretches so the column runs the full height of
  // the account area, with no gap and no outer padding around it.
  assert.match(layout, /flex w-full flex-col sm:flex-row sm:items-stretch/);
  assert.match(layout, /<AccountSidebar className="order-1" \/>/);
  assert.match(layout, /<div className="order-2 min-w-0 flex-1">\{children\}<\/div>/);
  // The column itself mirrors the approved preview: square corners,
  // the darker #0f1626 panel, a #26314d right border only, and the
  // preview widths (184px up to 900px, then 232px). Not a card: no
  // rounding, no shadow, no sticky floating.
  assert.match(sidebar, /bg-\[#0f1626\]/);
  assert.match(sidebar, /border-\[#26314d\]/);
  assert.match(sidebar, /sm:border-r/);
  assert.match(sidebar, /sm:w-\[184px\][^"]*min-\[901px\]:w-\[232px\]/);
  assert.doesNotMatch(sidebar, /rounded-3xl|shadow-2xl|sticky/);
  // Always fully visible: both group headings render above their
  // entries and every entry renders at every width — no hiding, no
  // details/dropdown collapse, no toggle button.
  assert.match(sidebar, /head: "Your account"/);
  assert.match(sidebar, /head: "Work"/);
  assert.doesNotMatch(sidebar, /\bhidden\b|<details|<button/);
  // Phones: the entry lists become horizontal wrapping strips; the
  // sidebar stays first in the shell, above the content.
  assert.match(sidebar, /<ul className="flex flex-row flex-wrap gap-\[2px\] sm:flex-col sm:flex-nowrap">/);
});

test("tool pages shell wraps only the signed-in work routes with the shared sidebar", () => {
  const layout = read("app/(english)/layout.tsx");
  assert.match(layout, /<ToolPagesShell>\{children\}<\/ToolPagesShell>/);
  const shell = read("app/components/ToolPagesShell.tsx");
  // Route gate: exactly the work/tool pages plus the Studio
  // workspace (and /audit/, which carries its own sidebar entry).
  for (const route of ["/studio", "/check", "/repository-audit", "/server-audit", "/audit", "/run", "/process-solution"]) {
    assert.ok(shell.includes("\"" + route + "\""), route);
  }
  assert.match(shell, /const WORK_ROUTES = \[/);
  // Session gate: the same client-side detection as the account
  // menu and the account layout.
  assert.match(shell, /customerApi<CustomerDashboard>\(API_BASE, "\/customer\/account", \{ method: "GET" \}\)/);
  assert.match(shell, /customerSessionChangedEvent/);
  // Signed out or off-route renders children exactly as before.
  assert.match(shell, /if \(!isWorkPage \|\| sessionState !== "signed-in"\) \{\n    return <>\{children\}<\/>;\n  \}/);
  // Signed in on a work page: the same edge-attached left column
  // shell as the account area.
  assert.match(shell, /data-tool-shell="signed-in"/);
  assert.match(shell, /flex w-full flex-col sm:flex-row sm:items-stretch/);
  assert.match(shell, /<AccountSidebar className="order-1" \/>/);
  assert.match(shell, /<div className="order-2 min-w-0 flex-1">\{children\}<\/div>/);
});

test("tool pages stack carries the same sidebar with both plain-line groups and the Audit entry", () => {
  const sidebar = read("app/components/AccountSidebar.tsx");
  assert.match(sidebar, /head: "Your account", entries: ACCOUNT_ENTRIES/);
  assert.match(sidebar, /head: "Work", entries: WORK_ENTRIES/);
  const hrefs = [...sidebar.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, [
    "/account/",
    "/account/api-keys/",
    "/account/live-center/",
    "/account/live-center/",
    "/account/api-keys/#sign-in-security",
    "/studio/",
    "/check/",
    "/repository-audit/",
    "/server-audit/",
    "/audit/",
    "/run/",
    "/process-solution/",
  ]);
  const labels = [...sidebar.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, [
    "Account home",
    "API account",
    "Live Center",
    "Runner minutes",
    "Sign-in & security",
    "Studio",
    "Workflow check",
    "Repository audit",
    "Server audit",
    "Audit",
    "Run in browser",
    "Process Solution",
  ]);
  assert.doesNotMatch(sidebar, /sub: "|entry\.sub|buy-minutes|label: "Buy minutes"/);
  assert.match(sidebar, /href: "\/audit\/"/);
});

test("homepage hero: dark island keeps light mode from hiding the headline", () => {
  const hero = read("app/components/homepage/InteractiveHero.tsx");
  const globals = read("app/globals.css");
  /* the hero artwork stays dark in both themes; the section re-pins dark tokens */
  assert.match(hero, /styles\.hero} dark-island relative isolate overflow-hidden/);
  assert.match(globals, /\.dark-island \{/);
  const island = globals.slice(globals.indexOf(".dark-island {"));
  assert.match(island, /--ink: #e6edf3;/);
  assert.match(island, /--body-text: #c9d1d9;/);
  assert.match(island, /--accent: #58a6ff;/);
  /* the headline stays on the token; the island is what makes it resolve dark */
  assert.match(hero, /id="homepage-title"[^>]*text-ink/);
});

test("homepage light bands: light island keeps dark mode from hiding band text", () => {
  const landing = read("app/components/homepage/LandingPage.tsx");
  const globals = read("app/globals.css");
  /* the bands' artwork stays light in both themes; the band re-pins light tokens */
  assert.match(globals, /\.light-island \{/);
  const island = globals.slice(globals.indexOf(".light-island {"));
  assert.match(island, /--ink: #0f172a;/);
  assert.match(island, /--body-text: #1e293b;/);
  assert.match(island, /--accent: #0969da;/);
  /* every literal-light band carries the island: capabilities (bg #f5f6f4),
     the Solve Context pin wrap (#eaf0f3), and quickstart (bg #f5f6f4) */
  assert.match(landing, /id="capabilities" className="light-island /);
  assert.match(landing, /id="quickstart" className="light-island /);
  assert.match(landing, /scPinWrap\} light-island/);
  /* the capability headline stays on the token; the island is what makes it resolve light */
  const landingCss = read("app/components/homepage/landing.module.css");
  assert.match(landingCss, /\.capabilityRow h3 \{[^}]*color: var\(--ink\)/);
});

test("homepage boundary section: text rides theme tokens, not literal light hexes", () => {
  const landing = read("app/components/homepage/LandingPage.tsx");
  const boundary = landing.slice(landing.indexOf('id="boundaries"'), landing.indexOf('id="capabilities"'));
  assert.match(boundary, /id="boundary-title"/);
  /* the section background follows the theme (var(--canvas) below); its text must
     follow too \u2014 the literal light hexes were written for the dark canvas and
     wash out on the light one (measured 1.9:1 / 1.5:1 / 2.1:1 settled) */
  assert.doesNotMatch(boundary, /text-\[#8ab7ff\]/);
  assert.doesNotMatch(boundary, /text-\[#c2cfdf\]/);
  assert.doesNotMatch(boundary, /text-\[#9fb0c6\]/);
  /* the heading accent span rides the accent token, like the section eyebrow
     and the ledger numbers in the same section */
  assert.match(boundary, /<span className="text-accent">Explicit boundaries\.<\/span>/);
  /* both intro paragraphs ride the body-text token, like the body copy of the
     sibling theme-following sections (evidenceLedger p, benchmarkBand p) */
  assert.match(boundary, /text-xl leading-8 text-body/);
  assert.match(boundary, /mt-6 max-w-2xl leading-8 text-body/);
  /* and the section itself stays theme-following \u2014 no island conversion */
  const landingCss = read("app/components/homepage/landing.module.css");
  assert.match(landingCss, /\.boundarySection \{ background: var\(--canvas\); \}/);
});

test("homepage sweep sections: text rides theme tokens, not literal light hexes", () => {
  const landing = read("app/components/homepage/LandingPage.tsx");
  /* the four remaining theme-following spots flagged after the boundary fix:
     the Studio, Evidence, Built, and Final sections sit on var(--canvas) /
     var(--panel), so their text must follow the theme too — the literal pale
     hexes were written for the dark canvas and wash out on the light one
     (measured 1.55:1 / 1.59:1 / 1.58:1 / 2.27:1 / 1.65:1 / 1.87:1 settled) */
  for (const literal of ["#a7cbff", "#b9c8dc", "#b8c9d9", "#93a9bd", "#bacbdf", "#8cb9ff"]) {
    assert.ok(!landing.includes(`text-[${literal}]`), `literal ${literal} is gone from the homepage`);
  }
  /* general guard: no literal text hex survives anywhere on the homepage's
     theme-following sections. The only literal text hexes allowed in the file
     are the theme-independent page root (dark text on its own literal light
     background) and the Solve Context light island (dark literals on its
     fixed light background) — strip exactly those two contexts, then the
     rest of the file must be clean. */
  const withoutRoot = landing.replace('<LandingAnimation className="bg-[#f5f6f4] text-[#102036]">', "");
  assert.ok(withoutRoot.length < landing.length, "the page-root literal context was found and stripped");
  const contextStart = withoutRoot.indexOf('id="solve-context"');
  const contextEnd = withoutRoot.indexOf('id="evidence"');
  assert.ok(contextStart >= 0 && contextEnd > contextStart, "the Solve Context island slice is located");
  const themeFollowing = withoutRoot.slice(0, contextStart) + withoutRoot.slice(contextEnd);
  assert.doesNotMatch(themeFollowing, /text-\[#[0-9a-fA-F]{3,8}\]/);
  /* Studio: the statement line is blue emphasis, so it rides the accent token
     like the boundary heading span; the paragraph under it rides body-text,
     like the .studioActions paragraphs in the same section */
  const studio = landing.slice(landing.indexOf('id="studio"'), landing.indexOf('id="solve-context"'));
  assert.match(studio, /tracking-\[-0\.03em\] text-accent sm:text-3xl/);
  assert.match(studio, /mt-5 max-w-xl leading-8 text-body/);
  /* Evidence: both the lead and the body paragraph ride the body-text token,
     like the evidenceLedger and benchmarkBand paragraphs in the same section */
  const evidence = landing.slice(landing.indexOf('id="evidence"'), landing.indexOf("styles.builtBand"));
  assert.match(evidence, /text-xl leading-8 text-body/);
  assert.match(evidence, /max-w-lg leading-8 text-body/);
  /* Built band: its paragraph rides the body-text token, like the
     benchmarkBand paragraph on the sibling band */
  const built = landing.slice(landing.indexOf("styles.builtBand"), landing.indexOf('id="quickstart"'));
  assert.match(built, /mt-2 text-body/);
  /* Final: the heading accent span rides the accent token — the same device
     as the boundary heading span fixed before it */
  const final = landing.slice(landing.indexOf("styles.finalSection"));
  assert.match(final, /<span className="text-accent">Automate second\.<\/span>/);
  /* and the sections themselves stay theme-following — no island conversion */
  const landingCss = read("app/components/homepage/landing.module.css");
  assert.match(landingCss, /\.studioSection \{ background: var\(--canvas\);/);
  assert.match(landingCss, /\.evidenceSection \{ background: var\(--canvas\); \}/);
  assert.match(landingCss, /\.builtBand \{[^}]*background: var\(--panel\);/);
  assert.match(landingCss, /\.finalSection \{ background: var\(--canvas\);/);
});

test("sidebar Work group carries the Audit entry after Server audit, active on /audit/", () => {
  const sidebar = read("app/components/AccountSidebar.tsx");
  // One plain single-line entry: the Audit label, the /audit/ target,
  // and the same onPath active-state rule as its Work-group neighbours.
  assert.match(
    sidebar,
    /id: "audit",\s+label: "Audit",\s+href: "\/audit\/",\s+isActive: \(path\) => onPath\("\/audit"\)\(path\)/,
  );
  // Position inside the Work group: after "Server audit", before
  // "Run in browser" (owner order Nov 14, 2026).
  const serverAt = sidebar.indexOf('label: "Server audit"');
  const auditAt = sidebar.indexOf('label: "Audit"');
  const runAt = sidebar.indexOf('label: "Run in browser"');
  assert.ok(serverAt >= 0 && auditAt > serverAt && runAt > auditAt, "Audit sits between Server audit and Run in browser");
  // Exactly one /audit/ target in the whole sidebar.
  assert.equal(sidebar.split('href: "/audit/"').length - 1, 1);
});

test("account back links point to the account home, one target everywhere", () => {
  const touched = [
    ["app/account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout.tsx", 1],
    ["app/account/api-checkout/EmbeddedApiCheckout.tsx", 2],
    ["app/account/merge-governance-checkout/EmbeddedMgovCheckout.tsx", 1],
    ["app/account/api-subscription/SubscriptionManager.tsx", 1],
    ["app/(english)/account/priority/page.tsx", 2],
    ["app/(english)/account/support-automation/page.tsx", 2],
  ];
  for (const [path, expected] of touched) {
    const source = read(path);
    assert.doesNotMatch(source, /href="\/account\/api-keys\/"/, `${path} must not carry a back-link href to /account/api-keys/`);
    assert.equal((source.match(/href="\/account\/"/g) || []).length, expected, `${path} back links must target /account/`);
  }
  // Labels are unchanged; only the hrefs moved.
  assert.match(read("app/account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout.tsx"), /href="\/account\/"[\s\S]*?Back to your account/);
  assert.match(read("app/account/api-checkout/EmbeddedApiCheckout.tsx"), /href="\/account\/"[\s\S]*?Back to API account/);
  assert.match(read("app/account/api-checkout/EmbeddedApiCheckout.tsx"), /href="\/account\/"[\s\S]*?Go to your API account/);
  assert.match(read("app/account/merge-governance-checkout/EmbeddedMgovCheckout.tsx"), /href="\/account\/"[\s\S]*?Back to your account/);
  assert.match(read("app/account/api-subscription/SubscriptionManager.tsx"), /href="\/account\/"[^>]*>← Back to API account/);
  assert.match(read("app/(english)/account/priority/page.tsx"), /href="\/account\/">Return to API account/);
  assert.match(read("app/(english)/account/support-automation/page.tsx"), /href="\/account\/">Return to API account/);
  // The Live Center already pointed at the account home; it stays that way.
  const board = read("app/account/live-center/LiveCenterBoard.tsx");
  assert.equal((board.match(/href="\/account\/"/g) || []).length, 3);
  assert.doesNotMatch(board, /href="\/account\/api-keys\/"/);
});

// --- S5c: connected repositories + auto-run state (account GitHub page) ---
const {
  normalizeGitHubBindings,
  normalizeRunnerMinutesAccount,
} = require("../.studio-test-dist/public-site/account/core/github-auto-run.js");
const connectedRepositories = read("app/(english)/account/github/ConnectedRepositories.tsx");
const githubAccountPage = read("app/(english)/account/github/page.tsx");

test("S5c section carries the heading and the plain-language intro verbatim", () => {
  assert.match(connectedRepositories, /Your repositories run themselves/);
  assert.match(connectedRepositories, /When a repository is connected, its checks run on SolveLang runners and use your prepaid minutes\. You do not need to do anything else\./);
  assert.match(githubAccountPage, /<ConnectedRepositories apiBase=\{API_BASE\} runnersApiBase=\{RUNNERS_API_BASE\} \/>/);
});

test("S5c customer copy keeps the banned words out of the new component", () => {
  assert.doesNotMatch(connectedRepositories, /tenant/i);
  assert.doesNotMatch(connectedRepositories, /installation/i);
  assert.doesNotMatch(connectedRepositories, /webhook/i);
  assert.doesNotMatch(connectedRepositories, /provision/i);
  assert.doesNotMatch(connectedRepositories, /\bJIT\b/);
  assert.doesNotMatch(connectedRepositories, /ledger/i);
});

test("S5c not-connected state connects through the connect-link route with a page fallback", () => {
  assert.match(connectedRepositories, /Connect GitHub/);
  assert.match(connectedRepositories, /customerApi<ConnectLinkResponse>\(apiBase, "\/customer\/github\/connect-link", \{ method: "GET" \}\)/);
  assert.match(connectedRepositories, /window\.location\.assign\(result\.installUrl\)/);
  assert.match(connectedRepositories, /githubInstallStartUrl\(apiBase\)/);
  assert.match(connectedRepositories, /Install the SolveLang app/);
});

test("S5c reads both contracts with the checkout fetch pattern", () => {
  assert.match(connectedRepositories, /customerApi<unknown>\(apiBase, "\/customer\/github\/bindings", \{ method: "GET" \}\)/);
  assert.match(connectedRepositories, /customerApi<unknown>\(runnersApiBase, "\/customer\/runner-minutes\/account", \{ method: "GET" \}\)/);
  assert.match(githubAccountPage, /NEXT_PUBLIC_RUNNER_MINUTES_BASE_URL \|\| "https:\/\/runners\.solve-lang\.com"/);
});

test("S5c connected state lists repositories and the account login in plain words", () => {
  assert.match(connectedRepositories, /Connected GitHub account:/);
  assert.match(connectedRepositories, /Connected — checks run on your minutes/);
  assert.match(connectedRepositories, /repository\.fullName/);
});

test("S5c auto-run state lines are verbatim", () => {
  assert.match(connectedRepositories, /Paused — your checks will not run and no minutes will be used\./);
  assert.match(connectedRepositories, /On — checks run automatically\./);
  assert.match(connectedRepositories, /minutesAccount\.status === "paused"/);
});

test("S5c totals render from the autoRun shape and stay absent without it", () => {
  const view = normalizeRunnerMinutesAccount({
    status: "paused",
    autoRun: {
      jobsServed: 7,
      minutesUsed: 42.5,
      secondsUsed: 2550,
      recentServes: [
        { repository: "octo/older", jobId: 11, minutes: 2, lane: "spot", outcome: "success", ranOnSolveLangRunner: true, at: "2026-11-10T10:00:00Z" },
        { repository: "octo/newer", jobId: 12, minutes: 3.5, lane: "spot", outcome: "success", ranOnSolveLangRunner: true, at: "2026-11-12T10:00:00Z" },
      ],
    },
  });
  assert.equal(view.status, "paused");
  assert.equal(view.autoRun.jobsServed, 7);
  assert.equal(view.autoRun.minutesUsed, 42.5);
  assert.equal(view.autoRun.secondsUsed, 2550);
  assert.deepEqual(view.autoRun.recentServes.map((serve) => serve.repository), ["octo/newer", "octo/older"]);
  const older = normalizeRunnerMinutesAccount({ balances: [] });
  assert.equal(older.status, "active");
  assert.equal(older.autoRun, null);
  assert.match(connectedRepositories, /Jobs run so far:/);
  assert.match(connectedRepositories, /Minutes used:/);
  assert.match(connectedRepositories, /autoRun\.recentServes\.slice\(0, 5\)/);
  assert.match(connectedRepositories, /\{autoRun \? \(/);
});

test("S5c bindings shape maps to the connected view and failures map to not connected", () => {
  const view = normalizeGitHubBindings({
    connected: true,
    installations: [{ accountLogin: "octo", state: "active" }],
    repositories: [{ fullName: "octo/repo", installationId: 42 }],
  });
  assert.equal(view.connected, true);
  assert.deepEqual(view.accounts, [{ login: "octo", state: "active" }]);
  assert.deepEqual(view.repositories, [{ fullName: "octo/repo", installationId: 42 }]);
  assert.equal(normalizeGitHubBindings(null).connected, false);
  assert.equal(normalizeGitHubBindings({}).connected, false);
  assert.equal(normalizeGitHubBindings({ connected: false }).connected, false);
  assert.match(connectedRepositories, /setBindings\(normalizeGitHubBindings\(null\)\)/);
  assert.match(connectedRepositories, /No GitHub account is connected yet\./);
});

test("legal footer stays compact on phones: wrapped link flow, never the tall column", () => {
  const footer = read("app/components/LegalFooter.tsx");
  assert.match(footer, /<nav aria-label="Policies and business contact" className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 sm:gap-x-5 sm:gap-y-2">/);
  assert.doesNotMatch(footer, /<nav[^>]*flex-col/);
  assert.match(footer, /<footer className="border-t border-white\/10 bg-\[#0a0e1a\] px-6 py-4 text-sm leading-6 text-slate-300 sm:py-6 sm:leading-7">/);
  assert.doesNotMatch(footer, /<footer[^>]*bg-white/);
});


test("runner minutes admin page exists, is noindexed, and carries the owner controls", () => {
  const page = read("app/(english)/account/runner-minutes-admin/page.tsx");
  // The owner panel is a real page, noindexed like its sibling
  // account pages, rendering the admin component.
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /<RunnerMinutesAdmin \/>/);
  const panel = read("app/account/runner-minutes-admin/RunnerMinutesAdmin.tsx");
  // It reads the owner proxy's account list and shows balances and
  // status in plain words, with the account id labeled, never raw.
  assert.match(panel, /ADMIN_ACCOUNTS_PATH/);
  assert.match(panel, /Account ID:/);
  assert.match(panel, /Standard minutes/);
  assert.match(panel, /High-power minutes/);
  assert.match(panel, /Paused/);
  assert.match(panel, /Active/);
  // The four owner controls are all there.
  assert.match(panel, /Add minutes/);
  assert.match(panel, /Take minutes/);
  assert.match(panel, /Pause account/);
  assert.match(panel, /Resume account/);
  // Destructive actions pass an explicit confirm step before firing.
  assert.match(panel, /Yes, take them/);
  assert.match(panel, /Yes, pause it/);
  assert.match(panel, /This cannot be undone/);
  // Anyone who is not the owner gets the plain not-available state.
  assert.match(panel, /This page is not available for your account\./);
  // The admin token is a server-side secret: nothing in the page may
  // ever name it or the upstream admin surface.
  assert.doesNotMatch(panel, /ADMIN_TOKEN|x-admin-token|\/admin\/accounts/);
});


test("manage page dashboard is regrouped under the five approved headings in order", () => {
  const page = read("app/(english)/account/api-keys/page.tsx");
  const dashboard = page.slice(page.indexOf('id="sign-in-security"'));
  const headings = [
    ">Sign-in & security</h2>",
    ">API keys</h2>",
    ">Plan & billing</h2>",
    ">Runner minutes</h2>",
    ">Connected accounts</h2>",
  ];
  let last = -1;
  for (const heading of headings) {
    const at = dashboard.indexOf(heading);
    assert.ok(at > last, `heading ${heading} is present and in order`);
    last = at;
  }
  // The security group container carries the exact sidebar anchor.
  assert.match(page, /<section id="sign-in-security" className="mt-10">/);
  // Existing dashboard sections live inside their groups.
  const securityAt = dashboard.indexOf('id="sign-in-security"');
  const accountSecurityAt = dashboard.indexOf("Account security");
  const apiKeysGroupAt = dashboard.indexOf(">API keys</h2>");
  assert.ok(accountSecurityAt > securityAt && accountSecurityAt < apiKeysGroupAt, "account security card sits in the sign-in & security group");
  const revealAt = dashboard.indexOf("Copy this key now");
  const createAt = dashboard.indexOf("Create API key");
  const planGroupAt = dashboard.indexOf(">Plan & billing</h2>");
  assert.ok(revealAt > apiKeysGroupAt && revealAt < planGroupAt, "key reveal sits in the API keys group");
  assert.ok(createAt > apiKeysGroupAt && createAt < planGroupAt, "create key form sits in the API keys group");
  const chooseAt = dashboard.indexOf("Choose an API plan");
  const minutesGroupAt = dashboard.indexOf(">Runner minutes</h2>");
  assert.ok(chooseAt > planGroupAt && chooseAt < minutesGroupAt, "choose-a-plan cards sit in the plan & billing group");
  // The runner minutes group is navigation only: it links to the Live
  // Center minutes view and the buy-minutes checkout.
  const minutesBlock = dashboard.slice(minutesGroupAt, dashboard.indexOf(">Connected accounts</h2>"));
  assert.match(minutesBlock, /\/account\/live-center\//);
  assert.match(minutesBlock, /\/account\/runner-minutes-checkout\//);
  assert.match(minutesBlock, />Buy minutes</);
  // The connected accounts group links to the GitHub page.
  const connectedBlock = dashboard.slice(dashboard.indexOf(">Connected accounts</h2>"));
  assert.match(connectedBlock, /\/account\/github\//);
});

test("manage page sign-in views keep their endpoints and logic markers", () => {
  const page = read("app/(english)/account/api-keys/page.tsx");
  // Password sign-in card and its endpoint.
  assert.match(page, /onSubmit=\{passwordLogin\}/);
  assert.match(page, /"\/customer\/auth\/password"/);
  // Email-link card and its endpoint.
  assert.match(page, /onSubmit=\{requestLink\}/);
  assert.match(page, /"\/customer\/auth\/magic-link"/);
  // GitHub sign-in button, Turnstile widget, and magic-token redemption.
  assert.match(page, /githubAuthorizeUrl\(API_BASE\)/);
  assert.match(page, /Continue with GitHub/);
  assert.match(page, /<SignInTurnstile onToken=\{setTurnstileToken\} resetSignal=\{botResetSignal\} \/>/);
  assert.match(page, /magicTokenFromHash\(window\.location\.hash\)/);
  assert.match(page, /"\/customer\/auth\/verify"/);
  // MFA view handler and endpoint.
  assert.match(page, /onSubmit=\{verifyMfa\}/);
  assert.match(page, /"\/customer\/auth\/totp\/verify"/);
  // The three screens are still the top-level views, in source order.
  const loadingAt = page.indexOf('if (screen === "loading")');
  const mfaAt = page.indexOf('if (screen === "signed-out" && mfaChallenge)');
  const signedOutAt = page.indexOf('if (screen === "signed-out") {');
  assert.ok(loadingAt !== -1 && mfaAt > loadingAt && signedOutAt > mfaAt, "loading, MFA, and signed-out views keep their order");
});

test("solutions library documents each problem in the four-part shape", () => {
  const { solutions } = require("../.studio-test-dist/public-site/(english)/solutions/solutions-data.js");
  assert.equal(solutions.length, 9, "the library documents exactly the nine known problems");
  assert.equal(new Set(solutions.map((entry) => entry.slug)).size, solutions.length, "solution slugs are unique");
  const routes = read("app/i18n/routes.ts");
  assert.match(routes, /segment: "solutions"[^\\n]+classification: "english-only-technical"[^\\n]+sitemap: true/);
  const article = read("app/(english)/solutions/SolutionArticle.tsx");
  for (const heading of ["Symptom", "Cause", "Fix", "Example"]) assert.match(article, new RegExp(`>${heading}<`), `article renders the ${heading} part`);
  const index = read("app/(english)/solutions/page.tsx");
  assert.match(index, /from "\.\/solutions-data"/);
  assert.match(index, /\/solutions\/\$\{entry\.slug\}\//, "index links every entry from the shared data");
  for (const entry of solutions) {
    assert.ok(entry.title.length > 0 && entry.summary.length > 0, `${entry.slug} carries a title and summary`);
    assert.ok(entry.symptom.length > 0 && entry.cause.length > 0 && entry.fix.length > 0, `${entry.slug} states a symptom, a cause, and fix steps`);
    assert.ok(entry.exampleText || entry.exampleCode, `${entry.slug} carries an example`);
    assert.match(routes, new RegExp(`segment: "solutions/${entry.slug}"[^\\\\n]+classification: "english-only-technical"`), `${entry.slug} is registered as an english-only technical route`);
    const page = read(`app/(english)/solutions/${entry.slug}/page.tsx`);
    assert.match(page, new RegExp(`alternatesForRoute\\("solutions/${entry.slug}"\\)`), `${entry.slug} page carries its own canonical alternates`);
    assert.match(page, /SolutionArticle/, `${entry.slug} page renders through the shared article`);
    assert.match(page, new RegExp(`solutionBySlug\\("${entry.slug}"\\)`), `${entry.slug} page renders its own entry`);
  }
  // The labels-and-pools entry documents marker routing on top of the
  // three exact label sets: extra labels may ride alongside a SolveLang
  // label, and a label set with no SolveLang label at all is not picked up.
  const labelsAndPools = solutions.find((entry) => entry.slug === "labels-and-pools");
  assert.ok(labelsAndPools, "labels-and-pools entry exists");
  const labelsFix = labelsAndPools.fix.join("\n");
  assert.match(labelsFix, /can ride alongside a SolveLang label/, "labels-and-pools states extra labels may ride alongside the SolveLang label");
  assert.match(labelsFix, /no SolveLang label at all is not picked up/, "labels-and-pools states a label set with no SolveLang label is not picked up");
  // Customer-facing copy states only what a customer can see or do: no
  // internal storage, infrastructure, or implementation vocabulary.
  assert.doesNotMatch(JSON.stringify(solutions), /ledger|dynamodb|lambda|\bec2\b|instance id/i);
});

test("job protection page states only the proven guarantees", () => {
  const { solutions } = require("../.studio-test-dist/public-site/(english)/solutions/solutions-data.js");
  const entry = solutions.find((candidate) => candidate.slug === "job-protection");
  assert.ok(entry, "job-protection entry exists");
  const fix = entry.fix.join("\n");
  // The membership list: every guarantee below traces to a live, proven
  // cure in the fixes-to-product study or the reliability pack that
  // landed after it. If a guarantee is ever removed from the service,
  // it must leave this page in the same change.
  assert.match(fix, /never billed for it/, "job protection states engine-runner-only billing");
  assert.match(fix, /can never be charged twice/, "job protection states exactly-once billing");
  assert.match(fix, /10-second minimum/, "job protection states the metering floor");
  assert.match(fix, /Pools never mix/, "job protection states pool separation");
  assert.match(fix, /reconciliation pass re-reads completed jobs/, "job protection states the safety net");
  assert.match(fix, /never shut down from under a running job/, "job protection states the termination guard");
  assert.match(fix, /re-served, never stranded/, "job protection states re-provisioning");
  assert.match(fix, /availability zones and machine families/, "job protection states diversification");
  assert.match(fix, /reads the full queue and the full runner list/, "job protection states full enumeration");
  assert.match(fix, /fails closed rather than showing another customer's numbers/, "job protection states per-account isolation");
  // The example cites the audit record with its exact numbers.
  assert.match(entry.exampleText, /54 of 54/, "job protection example cites the billing audit sample");
  assert.match(entry.exampleText, /63 charges/, "job protection example cites the duplicate scan");
  assert.match(entry.exampleText, /1,033 minutes/, "job protection example cites the safety net's first pass");
  // Proof discipline: the 30 GB workspace cure is merged but its
  // instance-level proof is still outstanding, so it is NOT claimed
  // until that proof lands (the study's membership rule).
  assert.doesNotMatch(JSON.stringify(entry), /30 GB|30GB/, "job protection does not claim the unproven workspace size");
  // The services page names the bundle and points at the page.
  const services = read("app/(english)/services/page.tsx");
  assert.match(services, /SolveLang Job Protection/, "services page names Job Protection");
  assert.match(services, /href="\/solutions\/job-protection\/"/, "services page links the Job Protection page");
});

test("speed is never free: the minutes surfaces state both speed prices", () => {
  const { solutions } = require("../.studio-test-dist/public-site/(english)/solutions/solutions-data.js");
  // How minutes work states the rule in its cause: faster processing
  // costs either 2x minutes on On-demand capacity or High-Power minutes
  // bought at the High-Power prices; Spot work on Standard machines
  // bills at the plain 1x rate.
  const howMinutes = solutions.find((entry) => entry.slug === "how-minutes-work");
  assert.ok(howMinutes, "how-minutes-work entry exists");
  const howCause = howMinutes.cause.join("\n");
  assert.match(howCause, /Faster processing is never free/, "how-minutes-work states speed is never free");
  assert.match(howCause, /On-demand capacity starts a job right away, and consumes your minutes at 2×/, "how-minutes-work names the 2x quota price");
  assert.match(howCause, /High-Power pool runs a job on larger, faster premium machines/, "how-minutes-work names the premium-machine price");
  assert.match(howCause, /bought at the higher High-Power prices/, "how-minutes-work names the High-Power prices");
  assert.match(howCause, /bills at the plain 1× rate/, "how-minutes-work keeps the plain Spot rate as the baseline");
  // Labels and pools states the same rule where the pools are explained.
  const labelsAndPools = solutions.find((entry) => entry.slug === "labels-and-pools");
  assert.ok(labelsAndPools, "labels-and-pools entry exists");
  const labelsFix = labelsAndPools.fix.join("\n");
  assert.match(labelsFix, /Speed is never free/, "labels-and-pools states speed is never free");
  assert.match(labelsFix, /High-Power minutes put a job on larger, faster premium machines at the High-Power prices/, "labels-and-pools names the premium-machine price");
  assert.match(labelsFix, /On-demand capacity starts a job right away while consuming minutes at 2×/, "labels-and-pools names the 2x quota price");
  // The services page states the rule in its Runner Minutes section.
  const services = read("app/(english)/services/page.tsx");
  assert.match(services, /Faster processing is never free/, "services page states speed is never free");
  assert.match(services, /work that starts on guaranteed On-demand capacity consumes minutes at 2×/, "services page names the 2x quota price");
  assert.match(services, /draws from the separate High-Power balance, bought at the High-Power prices below/, "services page names the premium-machine price");
});

test("status summary label and link use the theme accent token, never the low-contrast hexes", () => {
  const source = read("app/(english)/status/StatusHealth.tsx");
  // On the light theme the homepage evidence card sits on bg-panel (white);
  // the previous hard-coded hexes measured 2.1:1 (#93b6df) and 1.63:1
  // (#a9cdff) against the 4.5:1 WCAG AA requirement in Lighthouse/axe.
  assert.doesNotMatch(source, /#93b6df/i);
  assert.doesNotMatch(source, /#a9cdff/i);
  assert.match(source, /tracking-widest text-accent">Current public status/);
  assert.match(source, /ml-auto text-sm font-semibold text-accent underline/);
});

test("run page counts anonymous runs and says so plainly", () => {
  const page = read("app/(english)/run/page.tsx");
  assert.match(page, /Your code never leaves your browser \u2014 the only thing we record is an anonymous count that a run happened, never your code or its content\./);
  assert.doesNotMatch(page, /Nothing is sent to a server/);
  assert.match(page, /sendRunBeacon\("start"\)/);
  assert.match(page, /sendRunBeacon\("complete"\)/);
  const beacon = read("app/run/runBeacon.ts");
  assert.match(beacon, /\/telemetry\/run/);
  assert.match(beacon, /JSON\.stringify\(\{ event \}\)/);
});
