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
const landing = read("app/(english)/landing/page.tsx");
const prompts = JSON.parse(read("data/ai-search-prompts.json"));

test("verified brand facts preserve SolveLang maturity boundaries", () => {
  assert.match(
    brandFacts,
    /readable, explainable workflow language designed for AI-assisted business processes/i,
  );
  assert.match(brandFacts, /early beta/i);
  assert.match(brandFacts, /Rust CLI is the canonical runtime/i);
  assert.match(brandFacts, /deterministic, not AI analysis/i);
  assert.match(brandFacts, /experimental-test-mode/);
  assert.match(brandFacts, /Production-ready runtime/);
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
  ]) {
    assert.match(robots, new RegExp(crawler.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const privatePath of ["/account", "/api", "/checkout", "/success"]) {
    assert.ok(robots.includes(`\"${privatePath}\"`), `robots must exclude ${privatePath}`);
  }

  assert.doesNotMatch(robots, /GPTBot/);
  assert.doesNotMatch(robots, /ClaudeBot/);
  assert.match(robots, /https:\/\/www\.solve-lang\.com\/sitemap\.xml/);
});

test("sitemap route registry includes high-value public proof and excludes private utilities", () => {
  assert.match(routes, /segment: "status"[^\n]+sitemap: true/);
  assert.match(routes, /segment: "demo\/support-triage"[^\n]+sitemap: true/);
  assert.match(routes, /segment: "run"[^\n]+sitemap: true/);
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

test("homepage restores product storytelling without weakening maturity boundaries", () => {
  assert.match(landing, /See the system before you automate it\./);
  assert.match(landing, /Map the real workflow/);
  assert.match(landing, /Make every branch reviewable/);
  assert.match(landing, /Automate with control/);
  assert.match(landing, /Open Workflow Intelligence Studio/);
  assert.match(landing, /Workflow X-Ray/);
  assert.match(landing, /FAQPage/);
  assert.match(landing, /Rust CLI is the canonical runtime/);
  assert.match(landing, /Studio analysis is deterministic/);
  assert.match(landing, /browser preview supports a smaller safe subset/i);
  assert.match(landing, /Managed production execution is planned, not available today/);
  assert.match(landing, /\/terms\//);
  assert.match(landing, /\/refund-policy\//);
  assert.match(landing, /\/withdraw\//);
  assert.match(landing, /anpc-sal-pictogram\.png/);
});
