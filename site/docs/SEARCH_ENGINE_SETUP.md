# SolveLang search-engine setup

- Canonical domain: `https://www.solve-lang.com`
- Sitemap: `https://www.solve-lang.com/sitemap.xml`
- Robots: `https://www.solve-lang.com/robots.txt`

Verify the domain in Google Search Console and Bing Webmaster Tools using an owner-controlled DNS record or approved HTML verification, then submit the sitemap. Keep checkout, success, account, dashboard, private workflow, API-secret, and Romanian legal draft routes noindex and out of the sitemap.

Before release, run `npm run lint`, `npm run test:studio`, `npm run build`, and `git diff --check` from `site/`. Confirm page metadata, canonical URLs, production sitemap/robots output, and JSON-LD. General robots access permits search; a separate training-crawler policy requires an explicit owner decision and is not changed.
