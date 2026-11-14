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
  for (const route of ["landing", "about", "api-pricing", "check", "repository-audit", "run"]) {
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
  assert.match(read("app/(english)/landing/page.tsx"), /<StatusSummary\s*\/>/);
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
test("runner minutes checkout points at the live service by default", () => {
  const component = read("app/account/runner-minutes-checkout/EmbeddedRunnerMinutesCheckout.tsx");
  assert.match(component, /NEXT_PUBLIC_RUNNER_MINUTES_BASE_URL \|\| "https:\/\/runners\.solve-lang\.com"/);
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
