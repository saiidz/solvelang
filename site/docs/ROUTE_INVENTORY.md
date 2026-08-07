# SolveLang public route inventory

_Last verified: 2026-08-06._

This inventory classifies important browser routes by search/indexing intent. It is not an authorization map. Authentication and authorization must protect private data independently of robots directives.

## Public and indexable

| Route | Classification | Reason |
| --- | --- | --- |
| `/` | Public and indexable | Primary entity and product page. |
| `/about/` | Public and indexable | Entity, maturity, audience, and product explanation. |
| `/support/` | Public and indexable | Public support/contact information. |
| `/billing/` | Public and indexable | Public billing-policy information; not the private account-management surface. |
| `/refunds/` | Public and indexable | Public refund information. |
| `/terms/` | Public and indexable | Public legal terms. |
| `/refund-policy/` | Public and indexable | Public refund-policy information. |
| `/preflight-privacy/` | Public and indexable | Public privacy explanation for workflow preflight. |
| `/resources/` | Public and indexable | Public documentation/resource hub. |
| `/pricing/` | Public and indexable | Public service/product pricing context. |
| `/api-pricing/` | Public and indexable with maturity caveat | Public API-plan information must remain aligned to actual deployed status and must not imply production readiness. |
| `/n8n-workflow-validator/` | Public and indexable | Public deterministic workflow tool. |
| `/n8n-workflow-tester/` | Public and indexable | Public deterministic workflow tool. |
| `/n8n-error-checker/` | Public and indexable | Public deterministic workflow tool. |
| `/n8n-security-scanner/` | Public and indexable | Public deterministic workflow tool. |
| `/n8n-workflow-documentation-generator/` | Public and indexable | Public documentation tool. |
| `/run/` | Public and indexable | Browser-safe preview with explicit subset limitations. |
| `/repository-audit/` | Public and indexable | Public repository/workflow audit experience. |
| `/check/` | Public and indexable | Local deterministic n8n workflow preflight. |
| `/status/` | Public and indexable | Public manually maintained component/incident status. |
| `/demo/support-triage/` | Public and indexable | Canonical public demo with visible limitations and expected outputs. |

## Public but intentionally not in the sitemap / noindex utilities

| Route | Classification | Reason |
| --- | --- | --- |
| `/withdraw/` | Public utility | User/legal action route; not a search acquisition page. |
| `/studio/` | Public application | Useful product surface, but the current app is not relied on as an indexable explanatory page. Discovery should come through `/`, `/about/`, `/resources/`, and demos. |
| `/audit/` | Public conversion utility | Intake form rather than a standalone search answer page. |
| `/success/` | Noindex utility | Transaction/conversion completion page. |

## Authentication/account routes

| Route pattern | Classification | Rule |
| --- | --- | --- |
| `/account/*` | Authentication/account route | Exclude from public sitemap and public entity/schema surfaces. Protect account data through server-side authorization. |
| `/account/api-keys/` | Private customer route | API-secret management must never appear in sitemap, JSON-LD, llms.txt, or public metadata. |
| `/account/api-subscription/` | Private customer/billing route | Exclude from indexing and structured data. |
| `/account/api-checkout/` | Private/customer transaction route | Exclude from indexing and structured data. |

## Billing and payment routes

| Route pattern | Classification | Rule |
| --- | --- | --- |
| `/checkout/` | Billing/payment route | Exclude from sitemap and disallow from search crawling where practical. |
| `/success/` | Payment/utility completion | Noindex; no private transaction details in public markup. |

## Raw API endpoints

| Route pattern | Classification | Rule |
| --- | --- | --- |
| `/api/*` | Raw API endpoint | Not a public search page. Keep out of sitemap and robots-search surfaces. API documentation must live on public HTML pages instead. |

## Administrator routes

No public administrator route is intentionally exposed as an indexable product page. Any future administrator route must be authenticated, noindex, absent from sitemaps, and excluded from public structured data.

## Duplicate, obsolete, or disabled routes

| Route | Classification | Rule |
| --- | --- | --- |
| `/landing/` | Disabled/obsolete duplicate | Do not include in sitemap. The canonical homepage is `/`. |

## Route-policy rules

1. Only canonical public pages with durable user value belong in the sitemap.
2. Account, checkout, success, raw API, private customer, and administrator routes are never public search products solely because they have a URL.
3. `robots.txt` is not an access-control layer.
4. No API keys, account data, payment details, workflow uploads, private reports, internal IDs, or secrets may be embedded in public metadata, JSON-LD, sitemaps, or llms.txt.
5. Preview and experimental pages must state their maturity visibly.
