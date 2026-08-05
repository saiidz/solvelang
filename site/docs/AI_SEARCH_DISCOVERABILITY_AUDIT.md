# SolveLang discoverability audit

## Project and route classification

SolveLang is a Next.js public product and documentation site backed by an open-source Rust interpreter. Indexable public pages include the landing page, resources, about, supported workflow tools, and documented preview/Studio surfaces where they have an independent public purpose. Checkout, success, account, dashboard, private workflow data, billing state, API secrets, and Romanian legal drafts remain noindex or excluded.

Framework: Next.js. Current issue addressed: root metadata and JSON-LD described the product broadly enough to blur its beta, browser-preview, and deterministic-Studio boundaries.

## Implemented changes

`app/brandFacts.ts` provides the verified product definition, beta status, audiences, use cases, privacy boundaries, and prohibited claims. Root metadata and JSON-LD use this source and describe the local Rust CLI as canonical, the browser preview as intentionally smaller, and Studio as deterministic static analysis rather than AI analysis. The benchmark set and query map make those boundaries measurable.

## API and crawler boundaries

No public hosted API is described because the deployed documentation does not establish one. Billing or subscription screens do not prove API availability. General robots rules allow search crawlers while excluding private paths; model-training crawler preference remains an owner decision. Search Console/Bing verification, production bot/WAF checks, and rich-results validation require external access.

Sitemap status: checked-in public sitemap lists canonical public product and legal pages; protected checkout and private surfaces stay out. Structured-data types: Organization, WebSite, and SoftwareApplication. Validation: lint, 115 Studio tests, and production build passed. Risk: live crawler response and external-console evidence remain unavailable. Future content should prioritize versioned installation, syntax, safety, preview limits, Studio behavior, MCP boundaries, examples, and changelog documentation. Changed files: `app/brandFacts.ts`, `app/layout.tsx`, `app/page.tsx`, `data/ai-search-prompts.json`, and the four discoverability documents.
