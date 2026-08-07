# SolveLang search-engine setup

_Last verified: 2026-08-06._

Canonical public origin: `https://www.solve-lang.com`

This document describes repository and external-account steps. Repository code cannot complete Search Console, Bing Webmaster Tools, DNS ownership, or production CDN/WAF configuration on behalf of the owner.

## Public discovery endpoints

After deployment, verify:

- Homepage: `https://www.solve-lang.com/`
- Robots: `https://www.solve-lang.com/robots.txt`
- Sitemap: `https://www.solve-lang.com/sitemap.xml`
- Optional llms.txt: `https://www.solve-lang.com/llms.txt`
- Status: `https://www.solve-lang.com/status/`
- About: `https://www.solve-lang.com/about/`
- Browser preview: `https://www.solve-lang.com/run/`
- Support-triage demo: `https://www.solve-lang.com/demo/support-triage/`

## Google Search Console

Preferred verification method: DNS domain property for `solve-lang.com`.

1. Open Google Search Console and add the domain property `solve-lang.com`.
2. Add the DNS TXT record Google provides at the authoritative DNS provider.
3. Wait for DNS propagation and verify ownership.
4. Submit `https://www.solve-lang.com/sitemap.xml`.
5. Inspect `/`, `/about/`, `/run/`, `/status/`, and one public n8n tool with URL Inspection.
6. Confirm Google-selected canonical matches the declared `www` canonical.
7. Monitor Page Indexing, HTTPS, Core Web Vitals, and any detected structured-data issues.

Do not publish a fake verification token. If HTML-tag verification is preferred, place the owner-provided token in the framework metadata only after it is issued.

## Bing Webmaster Tools

1. Add `https://www.solve-lang.com/` in Bing Webmaster Tools or import the verified Search Console property if appropriate.
2. Complete DNS or meta-tag ownership verification using the owner-provided value.
3. Submit `https://www.solve-lang.com/sitemap.xml`.
4. Use URL Inspection for the homepage, About, browser preview, status page, and one documentation/tool page.
5. Review crawl errors and blocked-resource reports.

## IndexNow

IndexNow can be useful for public documentation, examples, status/content pages, and other durable URLs when they are added, updated, moved, or deleted.

Do not commit a real IndexNow key until the deployment path is agreed. If implemented later:

- generate a private high-entropy key;
- expose it only at the required public verification path;
- trigger IndexNow only for canonical public URLs;
- never submit account, checkout, success, API-secret, private report, or test URLs;
- log only safe URL/status metadata.

## Search crawler verification

After deployment, request public pages with representative user agents and verify a normal `200` HTML response without challenge pages.

Examples:

```bash
curl -I -A 'Googlebot' https://www.solve-lang.com/
curl -I -A 'bingbot' https://www.solve-lang.com/
curl -I -A 'OAI-SearchBot' https://www.solve-lang.com/
curl -I -A 'ChatGPT-User' https://www.solve-lang.com/
curl -I -A 'Claude-SearchBot' https://www.solve-lang.com/
curl -I -A 'PerplexityBot' https://www.solve-lang.com/
```

Expected: public pages return normal content, not `403`, `429`, CAPTCHA/challenge HTML, or empty shells.

Repeat against `/about/`, `/run/`, `/status/`, and `/sitemap.xml`.

## CDN / firewall review

If Cloudflare, AWS WAF, hosting bot protection, or rate limiting is enabled:

- confirm legitimate search crawlers are not challenged on public pages;
- do not weaken authentication for private routes;
- do not use robots rules as authorization;
- keep rate limits for raw APIs independent from public HTML crawler access;
- inspect logs for repeated legitimate crawler `403`/`429` responses.

## Search versus model-training crawler policy

Search visibility and model-training policy are separate decisions.

Search-oriented crawlers relevant to this project include:

- Googlebot
- bingbot
- OAI-SearchBot
- ChatGPT-User where applicable
- Claude-SearchBot
- Claude-User where applicable
- PerplexityBot

Training-policy crawlers such as GPTBot and ClaudeBot are intentionally **not given new project-specific allow/deny rules by this implementation** because no explicit owner training policy is recorded. The owner should make that decision separately. Do not change training policy merely to pursue search visibility.

## Canonical and redirect verification

Run after deployment:

```bash
curl -I http://solve-lang.com/
curl -I https://solve-lang.com/
curl -I https://www.solve-lang.com/
```

Confirm the preferred hostname/protocol resolves to one canonical HTTPS destination without redirect loops.

Verify trailing-slash behavior on representative pages and ensure canonical metadata uses the same normalized URL.

## Sitemap validation

```bash
curl -fsS https://www.solve-lang.com/sitemap.xml > /tmp/solvelang-sitemap.xml
curl -fsS https://www.solve-lang.com/robots.txt
```

Review that the sitemap contains only canonical public pages and excludes:

- `/account/*`
- `/checkout/`
- `/success/`
- raw `/api/*`
- disabled `/landing/`
- private test endpoints

## Structured-data validation

Use local JSON parsing/tests before deployment. After deployment, inspect representative pages with Google's Rich Results Test where applicable and Schema.org Validator for informational schema that is not a Google rich-result type.

Structured data improves entity clarity and eligibility; it does not guarantee a rich result or ranking.
