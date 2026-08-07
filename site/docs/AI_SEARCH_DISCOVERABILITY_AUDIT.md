# SolveLang AI Search Discoverability Audit

_Last verified: 2026-08-06._

## Project and domain

- Project: SolveLang
- Canonical domain: `https://www.solve-lang.com`
- Source repository: `https://github.com/saiidz/solvelang`
- Public positioning: **A readable, explainable workflow language designed for AI-assisted business processes.**
- Maturity: early beta; local Rust runtime is canonical; managed production workflow execution is not claimed.

## Framework

- Next.js 16 App Router public site
- TypeScript / React
- Rust CLI/runtime in `solvec/`
- Experimental/test-mode Node.js + AWS SAM API-access infrastructure

## Public route inventory

The detailed route classification is version-controlled in `site/docs/ROUTE_INVENTORY.md`.

High-value indexable pages include the homepage, About, Resources, public support/legal pages, public n8n tools, browser preview, repository audit, workflow preflight, status page, and canonical support-triage demo.

## Private / non-search route inventory

Excluded from the public search acquisition surface:

- `/account/*`
- `/checkout/`
- `/success/`
- raw `/api/*`
- disabled duplicate `/landing/`
- administrator/private routes if introduced later

`/studio/` and `/audit/` remain public application/conversion surfaces but are intentionally not relied on as sitemap acquisition pages in the current route registry.

## Problems found

1. Public metadata and structured data still used the older “workflow analysis and automation language” description after the product/portfolio mission established a narrower, more defensible positioning.
2. Entity facts were duplicated across README, metadata, JSON-LD, About, and llms.txt rather than sourced from one version-controlled fact object.
3. `/status/` existed publicly but was absent from the sitemap route registry.
4. The canonical support-triage demo was intentionally public but remained classified as a noindex utility and excluded from the sitemap.
5. Route normalization rejected nested public route segments, even though the canonical demo uses `demo/support-triage`.
6. `llms.txt` used older positioning and did not clearly separate working, experimental/test-mode, and planned capabilities.
7. No current project-level route inventory documented exactly which account/payment/API routes must remain outside public indexing.
8. No current automated SEO contract enforced search-crawler access, private-route exclusions, prompt benchmark count, and llms.txt privacy boundaries.
9. Search-oriented crawler policy and model-training crawler policy were not explicitly separated in repository documentation.
10. The public API pricing/account surfaces could be misinterpreted by search systems as evidence that a production API exists unless maturity language remains explicit.

## Implemented changes

### Verified source of truth

Added `site/app/brandFacts.ts` with:

- public/canonical names;
- canonical domain;
- current definition and detailed description;
- audiences, products, services, features, use cases, and differentiators;
- explicit working/preview/experimental-test-mode boundaries;
- verified claims and evidence locations;
- unverified and prohibited claims;
- privacy/security boundaries;
- approved calls to action.

### Visible entity clarity

Updated the About page to answer near the top:

- what SolveLang is;
- who it is for;
- what it does;
- what it does not do;
- which runtime is canonical;
- which features work today;
- which features are experimental/test-mode;
- which capabilities are planned.

### Metadata and structured data

Global metadata now uses the verified definition. The global JSON-LD graph includes stable identifiers for:

- `Organization`
- `WebSite`
- `SoftwareApplication`
- `SoftwareSourceCode`

The About page adds an `AboutPage` entity connected to the same stable software/website identifiers.

No fake ratings, reviews, pricing, availability, production scale, or customer claims are included.

### Crawl/indexing

Added a Next.js `robots.ts` policy that:

- allows normal public search crawling;
- preserves exclusions for `/account`, `/api`, `/checkout`, and `/success`;
- applies the same private-path exclusions to search-oriented Google/Bing/OpenAI/Anthropic/Perplexity crawler groups;
- references the canonical sitemap;
- does not silently create a GPTBot or ClaudeBot model-training policy.

Updated the sitemap route registry to include `/status/` and the canonical support-triage demo while keeping private and transactional routes excluded.

### AI-search benchmark and measurement

Added:

- `site/data/ai-search-prompts.json` with 40 realistic benchmark questions;
- `site/docs/SEARCH_QUERY_MAP.md`;
- `site/docs/SEARCH_ENGINE_SETUP.md`;
- `site/docs/AI_SEARCH_MEASUREMENT.md`.

### llms.txt

Updated the optional `site/public/llms.txt` convenience map to the current positioning and capability boundaries. It is not represented as a ranking factor or substitute for public HTML, sitemaps, metadata, or structured data.

## Verified claims used

- SolveLang is an early-beta workflow language/tooling project.
- The canonical runtime is implemented in Rust.
- The CLI supports run, validate, token, AST, and help behavior documented in the repository.
- Hardened modes and source-located diagnostics are implemented and tested.
- Workflow Intelligence Studio analysis is local-first and deterministic.
- The browser preview is smaller than the Rust runtime.
- AI/provider, side-effect helpers, and hosted API/account/billing infrastructure are experimental or test-mode.
- Public examples include support triage, lead qualification, intake/operations patterns, and additional documented business workflows.

## Unverified / excluded claims

Deliberately excluded:

- production-ready runtime;
- production managed workflow execution;
- production API availability inferred from billing/account screens;
- enterprise compliance certifications;
- uptime/SLA percentages;
- production performance benchmarks;
- customer count, adoption, revenue, or savings;
- guaranteed workflow correctness;
- guaranteed AI accuracy;
- ranking or AI-citation guarantees;
- “best”, “leading”, “number one”, or equivalent unsupported superiority claims.

## Conflicting descriptions found

The repository had an older public description centered on “workflow analysis and automation language,” while the completed product/portfolio mission established the narrower positioning “readable, explainable workflow language designed for AI-assisted business processes.” The latter is now the source-of-truth definition because it more accurately distinguishes the project from no-code automation platforms and avoids implying managed production automation.

Billing/API screens also create a potential interpretation conflict with the actual test-mode API maturity. The SEO source of truth explicitly prevents a pricing/subscription surface from being used as evidence of a production API.

## Structured-data types

Added/maintained:

- Organization
- WebSite
- SoftwareApplication
- SoftwareSourceCode
- AboutPage

Informational schema does not imply Google rich-result eligibility.

## Sitemap status

The sitemap is generated through the native Next.js metadata route and route registry.

Added to sitemap eligibility:

- `/status/`
- `/demo/support-triage/`

Excluded:

- `/account/*`
- `/checkout/`
- `/success/`
- raw APIs
- `/audit/`
- `/studio/`
- disabled `/landing/`

No `lastmod` value is invented where a reliable maintained page-update date is unavailable.

## Robots and crawler status

Repository policy allows search-oriented crawlers to public pages and preserves private-path exclusions. Production CDN/WAF behavior still requires post-deploy verification because repository code cannot prove that a hosting provider will not issue a challenge or rate limit to a legitimate crawler.

No model-training opt-in/opt-out policy was changed. That remains an owner policy decision.

## Privacy protections preserved

- account and API-key routes remain outside the sitemap/public schema;
- checkout/payment completion routes remain outside search acquisition;
- no workflow uploads, reports, API keys, payment details, cookies, customer IDs, or private account state are exposed in structured data, robots, sitemap, or llms.txt;
- robots directives are explicitly documented as crawler hints, not authorization controls.

## Tests

A repository SEO contract is added to verify:

- required brand facts and prohibited-claim boundaries;
- benchmark prompt count and uniqueness;
- search crawler groups;
- private-path exclusions;
- no silent GPTBot/ClaudeBot training policy change;
- `/status/` and canonical demo sitemap inclusion;
- account/checkout/success sitemap exclusion;
- llms.txt does not link private account/checkout/API-secret surfaces.

The existing required site gates remain:

```bash
cd site
npm run lint
npm run test:studio
npm run test:seo
npm run build
```

Production must not be considered validated if the build fails.

## External account actions remaining

- Google Search Console domain verification and sitemap submission;
- Bing Webmaster Tools verification and sitemap submission;
- production URL Inspection/canonical checks;
- production crawler user-agent checks against hosting/CDN/WAF;
- server/CDN crawler log review;
- structured-data validation against deployed HTML;
- analytics/referral configuration if desired;
- owner decision on model-training crawlers;
- IndexNow key and notification flow only if the owner chooses to implement it.

## Risks

1. Public API/account pricing can outrun actual API maturity if not kept synchronized.
2. The separate browser preview can drift semantically from the Rust runtime.
3. Public Studio copy can be misread as AI analysis if deterministic wording is removed later.
4. Search crawler access can still be blocked at CDN/WAF layers outside repository control.
5. Comparison content can become stale quickly; publish only evidence-backed comparisons that can be maintained.

## Recommended future content based on real user needs

Highest-value public documentation gaps:

1. versioned Getting Started / CLI documentation rendered as public HTML;
2. one consolidated Safety and Limitations page;
3. dedicated public pages for the strongest workflow examples;
4. a production API reference/status page only if and when the hosted API is actually verified as production;
5. factual comparison guides for workflow-language vs visual automation/runtime categories, maintained from primary sources.

## Exact files changed by this discoverability implementation

- `site/app/brandFacts.ts`
- `site/app/(english)/layout.tsx`
- `site/app/(english)/about/page.tsx`
- `site/app/i18n/routes.ts`
- `site/app/robots.ts`
- `site/data/ai-search-prompts.json`
- `site/public/llms.txt`
- `site/docs/ROUTE_INVENTORY.md`
- `site/docs/SEARCH_QUERY_MAP.md`
- `site/docs/SEARCH_ENGINE_SETUP.md`
- `site/docs/AI_SEARCH_MEASUREMENT.md`
- `site/docs/AI_SEARCH_DISCOVERABILITY_AUDIT.md`
- `site/qa/seo-contract.test.mjs`
- `site/package.json`
