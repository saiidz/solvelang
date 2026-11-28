import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const brandFacts = read("app/brandFacts.ts");
const robots = read("app/robots.ts");
const routes = read("app/i18n/routes.ts");
const llms = read("public/llms.txt");
const landing = read("app/components/homepage/LandingPage.tsx");
const layout = read("app/(english)/layout.tsx");
const socialSvg = read("public/solvelang-social-preview.svg");
const prompts = JSON.parse(read("data/ai-search-prompts.json"));
const publicPositioning = [
  brandFacts,
  llms,
  landing,
  read("app/(english)/about/page.tsx"),
  read("app/(english)/layout.tsx"),
  read("app/(english)/page.tsx"),
  read("app/(english)/run/page.tsx"),
  read("app/check/WorkflowPreflight.tsx"),
].join("\n");

test("public positioning does not use beta labels", () => {
  assert.doesNotMatch(publicPositioning, /\bbeta\b/i);
});

test("verified brand facts preserve SolveLang maturity boundaries", () => {
  assert.match(
    brandFacts,
    /readable, explainable workflow language designed for AI-assisted business processes/i,
  );
  assert.match(brandFacts, /general managed workflow execution/i);
  assert.match(brandFacts, /Rust CLI is the canonical runtime/i);
  assert.match(brandFacts, /deterministic, not AI analysis/i);
  assert.match(brandFacts, /experimental-test-mode/);
  assert.match(brandFacts, /Production-ready runtime/);
});

test("social preview uses the canonical static image without external SVG resources", () => {
  assert.match(layout, /const socialImagePath = "\/solvelang-social-preview\.png"/);
  assert.match(layout, /images: \[\{ url: socialImagePath, width: 1200, height: 630/);
  assert.match(layout, /twitter: \{ card: "summary_large_image"[^\n]+images: \[socialImagePath\]/);
  assert.match(socialSvg, /width="1200" height="630"/);
  assert.match(socialSvg, /Understand first\. Automate second\./);
  assert.doesNotMatch(socialSvg, /<image\b|<script\b|<foreignObject\b|@import|(?:href|src)="(?:https?:|\/\/|data:)/i);
});

test("AI-search prompt benchmark is large enough and duplicate-free", () => {
  assert.ok(Array.isArray(prompts));
  assert.ok(prompts.length >= 25, `expected at least 25 prompts, found ${prompts.length}`);
  const normalized = prompts.map((prompt) => String(prompt).trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length, "AI-search prompts must be unique");
  assert.ok(prompts.every((prompt) => typeof prompt === "string" && prompt.trim().endsWith("?")));
});

test("robots policy allows search crawlers without exposing private paths", () => {
  for (const crawler of [
    "Googlebot",
    "bingbot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "GPTBot",
    "ClaudeBot",
  ]) {
    assert.match(robots, new RegExp(crawler.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const privatePath of ["/account", "/api", "/checkout", "/success"]) {
    assert.ok(robots.includes(`\"${privatePath}\"`), `robots must exclude ${privatePath}`);
  }

  assert.match(robots, /https:\/\/www\.solve-lang\.com\/sitemap\.xml/);
});

test("sitemap route registry includes high-value public proof and excludes private or test-mode utilities", () => {
  assert.match(routes, /segment: "status"[^\n]+sitemap: true/);
  assert.match(routes, /segment: "demo\/support-triage"[^\n]+sitemap: true/);
  assert.match(routes, /segment: "run"[^\n]+sitemap: true/);
  assert.match(routes, /segment: "studio"[^\n]+sitemap: true/);
  assert.match(routes, /segment: "api-pricing"[^\n]+sitemap: true/);
  assert.match(routes, /segment: "process-solution"[^\n]+sitemap: true/);
  assert.match(routes, /segment: "security-scan"[^\n]+sitemap: true/);
  assert.match(routes, /segment: "ci-bill-check"[^\n]+sitemap: true/);
  assert.match(routes, /segment: "change-impact-receipt"[^\n]+sitemap: true/);
  assert.match(routes, /segment: "services"[^\n]+sitemap: true/);
  assert.match(routes, /segment: "checkout"[^\n]+sitemap: false/);
  assert.match(routes, /segment: "success"[^\n]+sitemap: false/);
  assert.doesNotMatch(routes, /segment: "account"[^\n]+sitemap: true/);
});

test("llms convenience map stays public-only and truth-labeled", () => {
  assert.match(llms, /readable, explainable workflow language/i);
  assert.match(llms, /## Working today/);
  assert.match(llms, /## Experimental or test-mode/);
  assert.match(llms, /## Planned/);
  assert.doesNotMatch(llms, /https:\/\/www\.solve-lang\.com\/account\//);
  assert.doesNotMatch(llms, /https:\/\/www\.solve-lang\.com\/checkout\//);
  assert.doesNotMatch(llms, /api[_-]?key/i);
});

test("llms states Process Solution merge governance as live, never pilot", () => {
  assert.ok(
    llms.includes("- [Services](https://www.solve-lang.com/services/): Runner minutes, API access plans, and Process Solution merge governance — live, with no public price and no self-serve signup"),
    "llms.txt Services entry states Process Solution as live",
  );
  assert.doesNotMatch(llms, /pilot/i);
});

test("llms pricing facts state the exact shelf and the embedded-payment fact", () => {
  assert.match(llms, /## Pricing facts/);
  for (const fact of [
    "5,000 minutes for $20",
    "25,000 minutes for $100",
    "100,000 minutes for $400",
    "1,000 minutes for $80",
    "2,000 minutes for $140",
    "3,000 minutes for $192",
    "4,000 minutes for $236",
    "5,000 minutes for $275",
    "6,000 minutes for $306",
    "7,000 minutes for $336",
    "8,000 minutes for $360",
    "9,000 minutes for $382.50",
    "10,000 minutes for $400",
    "10-second minimum per job",
    "on-demand capacity draw at 2\u00d7",
    "Developer $49",
    "Pro $199",
    "Business $699",
    "only through its own embedded payment pages",
    "never through external checkout pages",
  ]) {
    assert.ok(llms.includes(fact), `llms.txt states: ${fact}`);
  }
});

test("llms pricing facts state the per-pull-request pool choice with the exact PR labels", () => {
  assert.match(llms, /chosen per pull request with a pull request label/);
  for (const fact of [
    "solvelang-runners-high-power",
    "solvelang-runners-standard",
    "drawing from the High-Power balance",
    "drawing from the Standard balance",
    "jobs already running are not moved",
  ]) {
    assert.ok(llms.includes(fact), `llms.txt states: ${fact}`);
  }
  // The pool price lines themselves are unaltered by the addition.
  assert.ok(llms.includes("Runner minutes, Standard pool (2-vCPU-class Linux machines): 5,000 minutes for $20 · 25,000 minutes for $100 · 100,000 minutes for $400."));
  assert.ok(llms.includes("Runner minutes, High-Power pool (16-vCPU-class Linux machines): 1,000 minutes for $80"));
  assert.ok(llms.includes("10,000 minutes for $400."));
});

test("llms job protection section states the guarantees and links the page", () => {
  assert.match(llms, /## Job Protection/);
  assert.ok(llms.includes("https://www.solve-lang.com/solutions/job-protection/"), "llms.txt links the Job Protection page");
  assert.match(llms, /billed only for jobs a SolveLang machine actually ran, exactly once/);
  assert.match(llms, /never shut down from under a running job/);
});

test("llms.txt follows the llmstxt.org structure", () => {
  // H1 first, then a blockquote summary (the two elements the previous
  // free-prose file lacked when PageSpeed flagged it, Nov 15 2026).
  assert.match(llms, /^# SolveLang\n\n> SolveLang is a readable, explainable workflow language/);
  // Resource entries are markdown links with a one-line description,
  // never bare URLs after a colon.
  assert.match(llms, /^- \[Website\]\(https:\/\/www\.solve-lang\.com\/\): /m);
  assert.doesNotMatch(llms, /^- [^\[]+: https:\/\//m);
  // Secondary links live under the spec's Optional section.
  assert.match(llms, /## Optional\n\n- \[Source repository\]\(https:\/\/github\.com\/saiidz\/solvelang\): /);
  assert.match(llms, /- \[License\]\(https:\/\/github\.com\/saiidz\/solvelang\/blob\/main\/LICENSE\): /);
});

test("homepage follows the approved product order and preserves maturity boundaries", () => {
  const sections = ["<InteractiveHero />", "id=\"boundaries\"", "id=\"capabilities\"", "id=\"studio\"", "id=\"solve-context\"", "id=\"evidence\"", "id=\"runner-minutes\"", "className={styles.builtBand}", "id=\"quickstart\"", "className={styles.finalSection}"];
  let previous = -1;
  for (const section of sections) { const index = landing.indexOf(section); assert.ok(index > previous, `${section} follows the previous section`); previous = index; }
  assert.match(landing, /Real capability\./);
  assert.match(landing, /Explicit boundaries\./);
  assert.match(landing, /Repository-tested/);
  assert.match(landing, /Deployed/);
  assert.match(landing, /VERIFIED LIVE/);
  assert.doesNotMatch(landing, /temporary acceptance-origin cleanup remains a separate follow-up/i);
  assert.match(landing, /Real provider token and performance comparisons will be published only when the independent evaluation supports them/);
  assert.match(landing, /host side effects denied/);
  assert.match(landing, /general managed execution remain separate gates/);
  assert.doesNotMatch(landing, /FAQPage/);
  assert.match(landing, /\/terms\//);
  assert.match(landing, /\/refund-policy\//);
  assert.match(landing, /\/withdraw\//);
  assert.match(landing, /anpc-sal-pictogram\.png/);
});

test("compatibility page states the platform truth without overclaiming", () => {
  assert.match(routes, /segment: "compatibility"[^\n]+sitemap: true/);
  const page = read("app/(english)/compatibility/page.tsx");
  assert.match(page, /canonical: "https:\/\/www\.solve-lang\.com\/compatibility\/"/);
  for (const host of ["GitHub", "GitLab", "Bitbucket", "Azure DevOps", "Codeberg", "Forgejo", "Gitea", "SourceHut", "OneDev", "Radicle"]) {
    assert.ok(page.includes(host), `compatibility page must name ${host}`);
  }
  // The context products are the ones scoped to every host.
  assert.match(page, /Every host listed below/);
  assert.match(page, /Hosted MCP endpoint and Team Index/);
  // Runner minutes and governance are stated as GitHub today, in progress
  // for more platforms, with no dates and no promises.
  assert.match(page, /Runner minutes and the Process Solution merge-governance engine currently run on\s+GitHub/);
  assert.match(page, /Extending both to more platforms is in progress/);
  assert.match(page, /no dates\s+and no promises/);
  // …and they are never paired with any other platform as supported today.
  const otherPlatforms = "(?:GitLab|Bitbucket|Azure DevOps|Codeberg|Forgejo|Gitea|SourceHut|OneDev|Radicle)";
  assert.doesNotMatch(page, new RegExp(`Runner minutes[\\s\\S]{0,120}${otherPlatforms}`, "i"));
  assert.doesNotMatch(page, new RegExp(`governance[\\s\\S]{0,120}${otherPlatforms}`, "i"));
});

test("homepage runner minutes section answers the cost question with the dated GitHub comparison (GEO/AEO edit 2)", () => {
  assert.match(landing, /How much do GitHub Actions minutes cost \u2014 and what does SolveLang charge\?/);
  assert.match(landing, /GitHub charges \$0\.006 per minute for a standard 2-core Linux runner and rounds every job up to a whole minute/);
  assert.match(landing, /SolveLang Standard costs \$0\.004 per minute and meters per second with a 10-second minimum/);
  assert.match(landing, /a 12-second job costs 12 seconds, not a minute/);
  assert.match(landing, /Whole minute, rounded up per job/);
  assert.match(landing, /Per second, 10-second minimum/);
  assert.match(landing, /\$30 at list rate/);
  assert.match(landing, /\$20 \(pack\)/);
  assert.match(landing, /300 free minutes, no card, 30 days/);
  assert.match(landing, /rate card, January 2026/);
  assert.doesNotMatch(landing, /44%/);
});

test("ci-bill-check page carries the question heading and the dated GitHub rate table (GEO/AEO edit 3)", () => {
  const page = read("app/(english)/ci-bill-check/page.tsx");
  assert.match(page, /Why is my GitHub Actions bill so high\?/);
  assert.match(page, /Two meters set the bill: the per-minute rate and the number of minutes rounding creates/);
  assert.match(page, /a 12-second job bills as 60 seconds/);
  assert.match(page, /over the measured sample only/);
  assert.match(page, /\$0\.006\/min/);
  assert.match(page, /\$0\.010\/min/);
  assert.match(page, /\$0\.062\/min/);
  assert.match(page, /January 2026 rate card; read November 28, 2026/);
  assert.doesNotMatch(page, /\$0\.008|\$0\.016/);
});

test("runner-pricing-compared page carries the dated honest rate table (GEO/AEO edit 4)", () => {
  const routes = read("app/i18n/routes.ts");
  assert.match(routes, /segment: "runner-pricing-compared", classification: "english-only-technical", sitemap: true/);
  const page = read("app/(english)/runner-pricing-compared/page.tsx");
  assert.match(page, /SolveLang is not the cheapest headline rate in this table\. It is the only one that meters per second\./);
  assert.match(page, /read from the provider\u2019s own published pricing page on November 26, 2026/);
  assert.match(page, /Sengi \(Basic\)/);
  assert.match(page, /\$0\.00125\u20130\.002/);
  assert.match(page, /Latchkey/);
  assert.match(page, /\$0\.0025/);
  assert.match(page, /Blacksmith/);
  assert.match(page, /WarpBuild/);
  assert.match(page, /Depot/);
  assert.match(page, /Per second, 10-second minimum/);
  assert.match(page, /GitHub \$600/);
  assert.match(page, /SolveLang Standard: \$400/);
  assert.match(page, /postponed it before it took effect \u2014 it is not in force as of November 2026/);
  assert.doesNotMatch(page, /44%|25% faster/);
});

test("process-solution page carries the FAQ block with approved status language (GEO/AEO edit 5)", () => {
  const page = read("app/(english)/process-solution/page.tsx");
  assert.match(page, /What is merge governance\?/);
  assert.match(page, /deciding, with evidence, what is allowed to land on your main branch/);
  assert.match(page, /How is Process Solution different from GitHub\u2019s merge queue\?/);
  assert.match(page, /bisects the batch, ejects only the guilty PR with its reason, and lands the rest/);
  assert.match(page, /What does it cost\?/);
  assert.match(page, /There is no public price and no self-serve signup yet\. Process Solution is live and onboarding a small number of design-partner teams\./);
  assert.match(page, /Does my code leave my infrastructure\?/);
  assert.match(page, /never a checkout/);
  assert.match(page, /Process Solution is live\. The full governed cycle \u2014 plan, combined tree, battery, land/);
});

test("depot-alternative page carries Depot own dated figures (SEO Phase 1 #7a)", () => {
  const routes = read("app/i18n/routes.ts");
  assert.match(routes, /segment: "depot-alternative", classification: "english-only-technical", sitemap: true/);
  const page = read("app/(english)/depot-alternative/page.tsx");
  assert.match(page, /read November 28, 2026/);
  assert.match(page, /\$0\.006\/min for the base 2 vCPU Linux/);
  assert.match(page, /Developer is \$20\/mo and includes 2,000/);
  assert.match(page, /Startup is \$200\/mo and includes 20,000/);
  assert.match(page, /tracks usage by the second, but bills whole minutes at month end/);
  assert.match(page, /No plan fee/);
  assert.match(page, /utm_campaign=depot-alternative/);
  assert.doesNotMatch(page, /44%|25% faster/);
});
