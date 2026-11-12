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
  assert.match(accountMenu, /\/account\/live-center\//);
  assert.match(accountMenu, />Live Center</);
  assert.match(read("app/(english)/account/api-keys/page.tsx"), /\/account\/live-center\//);
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
  for (const id of ["account-persistence", "billing", "support", "ci-deployment"]) assert.equal(statusPage.components.find((component) => component.id === id).monitored, true, `${id} is live-probed`);
  for (const id of ["provider-execution", "posthog"]) assert.equal(statusPage.components.find((component) => component.id === id).monitored, false, `${id} has no live signal and stays unmonitored`);
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
  for (const page of ["api-pricing/page.tsx", "billing/page.tsx", "pricing/page.tsx"]) assert.match(read(`app/(english)/${page}`), /billingAvailability/);
  assert.match(read("app/(english)/status/status-data.ts"), /Live probe:/);
  assert.match(billingAvailability, /Production API subscription billing/);
  assert.match(billingAvailability, /API plans are purchasable today/);
  assert.doesNotMatch(billingAvailability, /canary is still pending/);
  assert.match(read("app/brandFacts.ts"), /status: "production"/);
  assert.match(read("public/llms.txt"), /Production API subscription billing and checkout are live/);
  assert.equal(capabilityGroups.find((group) => group.id === "billing").description, billingAvailability);
  for (const page of ["landing", "about", "api-pricing"]) assert.doesNotMatch(read(`app/(english)/${page}/page.tsx`), /Test-mode API access, account|only in the protected SolveLang test environment/);
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
} = require("../.studio-test-dist/public-site/(english)/landing/animation.js");
const landingAnimation = read("app/(english)/landing/LandingAnimation.tsx");
const landingAnimCss = read("app/(english)/landing/animation.module.css");
const landingAnimEngine = read("app/(english)/landing/animation.ts");
const landingPage = read("app/(english)/landing/page.tsx");
const landingCss = read("app/(english)/landing/landing.module.css");

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
