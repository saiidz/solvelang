# SolveLang AI-search and organic-search measurement plan

_Baseline date: 2026-08-06._

This plan defines how to measure discoverability without inventing an AI-visibility score or claiming success before search systems actually crawl and cite the project.

## Baseline fields

Populate these from external tools after the relevant property/account is verified:

- Baseline indexed-page count: **not yet measured in repository**
- Baseline branded-query impressions/clicks: **requires Search Console/Bing data**
- Baseline non-branded-query impressions/clicks: **requires Search Console/Bing data**
- Baseline ChatGPT referrals: **requires analytics/server logs**
- Baseline Perplexity referrals: **requires analytics/server logs**
- Baseline Bing/Copilot referrals: **requires analytics/server logs**
- Baseline Claude referrals: **requires identifiable referrer/user-agent evidence where available**
- Baseline crawler success/error rate: **requires server/CDN logs**

Do not substitute repository page count for indexed-page count.

## Question benchmark

Canonical benchmark set: `site/data/ai-search-prompts.json`.

The set covers:

- brand identity and maturity;
- installation and CLI;
- language behavior and safety;
- browser preview and Studio boundaries;
- AI/provider capabilities;
- workflow use cases;
- n8n tooling;
- API status and pricing boundaries;
- privacy, status, roadmap, source, license, and support.

## Monthly AI-answer procedure

Once per month:

1. Freeze the benchmark question set for that measurement window.
2. Record the date, platform, signed-in/signed-out state when relevant, locale, and query wording.
3. Ask the same questions in Google Search/AI experiences, Bing/Copilot, ChatGPT Search, Claude web search, and Perplexity where available.
4. Record whether SolveLang is mentioned.
5. Record whether the canonical domain or GitHub repository is cited/linked.
6. Record the factual description used.
7. Mark inaccuracies such as:
   - calling SolveLang production-ready;
   - treating browser preview as the full Rust runtime;
   - describing deterministic Studio analysis as AI analysis;
   - inferring a production API from account/billing screens;
   - describing SolveLang as a Zapier-style connector marketplace.
8. Record source URLs shown by the platform where available.
9. Do not repeatedly query in a way intended to manipulate ranking systems.

## Citation record

Recommended CSV/Sheet fields:

- `observed_at`
- `platform`
- `question_id`
- `question`
- `mentioned` (`yes/no`)
- `citation_present` (`yes/no`)
- `cited_url`
- `description_accurate` (`yes/no/partial`)
- `incorrect_claim`
- `notes`

Do not turn this into a synthetic composite score unless a formula, weighting, sample size, and limitations are explicitly documented.

## Search Console measurement

Monthly review:

- indexed pages and excluded-page reasons;
- sitemap processing errors;
- Google-selected canonical mismatches;
- branded queries (`SolveLang`, `Solve Lang`, `solvec` where relevant);
- non-branded queries around workflow language, workflow-as-code, workflow preflight, n8n validation, human-in-the-loop workflow design, and related real features;
- page-level clicks/impressions for `/`, `/about/`, `/run/`, `/status/`, demo, resources, and public n8n tools;
- mobile/Core Web Vitals issues.

When Google reports generative-AI/search-feature traffic in available interfaces, record it separately rather than assuming ordinary organic impressions are AI citations.

## Bing Webmaster Tools measurement

Monthly review:

- indexed URL count;
- crawl and sitemap issues;
- branded/non-branded query visibility;
- canonical issues;
- URL Inspection for recently changed public pages.

## Referral measurement

Where privacy policy and analytics configuration allow, group referrals by source without storing sensitive workflow/customer content.

Suggested source categories:

- `google-organic`
- `bing-organic`
- `chatgpt-referral`
- `perplexity-referral`
- `claude-referral`
- `copilot-referral`
- `github`
- `direct/unknown`

Referral-domain detection can be imperfect because applications may suppress or transform referrers. Document unknown attribution rather than guessing.

## Conversion events

Useful conversions for SolveLang may include:

- GitHub outbound click;
- browser-preview start;
- Studio open;
- support-triage demo view;
- workflow audit/contact CTA;
- documentation/resource view;
- API-pricing/account interest **only when the API status is accurately labeled**.

Do not count page views as customers, users, or revenue.

## Server/CDN crawler monitoring

Aggregate safe request metadata for legitimate crawlers where available:

- crawler family/user agent;
- timestamp bucket;
- requested public path;
- response status;
- response time bucket;
- cache outcome;
- WAF/challenge/rate-limit outcome.

Do not log authorization headers, API keys, cookies, uploaded workflow bodies, query-string secrets, payment data, account IDs, or private report content for SEO measurement.

Watch specifically for legitimate crawler `403`, `429`, challenge pages, and repeated `5xx` responses.

## Structured-data monitoring

Track:

- parsing errors;
- Search Console enhancement reports where applicable;
- entity identifiers and canonical URLs staying stable;
- schema claims matching visible content;
- accidental price/availability drift.

Schema markup does not guarantee a rich result.

## Monthly change log

For each discoverability release, record:

- commit/PR;
- public URLs added/removed/redirected;
- metadata or schema changes;
- sitemap/robots changes;
- material content changes;
- measurement date before and after;
- external verification actions completed.

## Decision rules

- If AI answers describe a capability incorrectly, improve the authoritative visible page first before adding more schema.
- If crawlers cannot reach public pages, fix WAF/CDN/robots/HTTP behavior before creating more content.
- If a page has impressions but poor engagement, improve the direct answer and title/description without keyword stuffing.
- If a query has no relevant page, create one only when it serves a real user need.
- Do not create doorway pages, fake comparison pages, or mass-produced location/content variants to chase visibility.
