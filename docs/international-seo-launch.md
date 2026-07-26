# International SEO and Translation Launch

## Current publication matrix

`en` is the sole reviewed and indexable locale. `ro`, `fr`, `de`, `es`, `it`, `pt-BR`, `nl`, `pl`, `cs`, `tr`, `ar`, `he`, `ru`, `uk`, `zh-Hans`, `zh-Hant`, `ja`, `ko`, `hi`, `id`, `vi`, `th`, `sv`, `da`, `no`, `fi`, and `el` are draft. Draft locales are noindex, excluded from sitemap and hreflang clusters, and cannot use checkout.

The locale registry at `site/app/i18n/locales.ts` is canonical. It records the BCP 47 and hreflang values, lowercase URL segment, direction, publication state, revision, marketing/legal/checkout review status, checkout allowance, reviewer, and review date. Do not mark a translation reviewed because it was machine generated.

## Adding or retiring a locale

Add one registry entry and a complete dictionary. Build-time dictionary validation must pass. Keep the locale `draft` until a named human reviewer has completed marketing review. Legal pages and checkout require separate legal and checkout-translation review. Only then may a locale become `reviewed`; it still needs explicit checkout allowance before any localized checkout can be offered. To retire a locale, mark it `disabled`, remove it from reviewed sitemap/hreflang generation, retain a reviewed migration decision, and avoid redirecting it by visitor IP.

Use language-only routes by default, such as `/fr/support/`. Add a regional variant only when price, currency, taxation, mandatory legal wording, availability, terminology, support, operator identity, or delivery terms differ materially. A regional variant must receive its own canonical/hreflang cluster and review record.

## Static SEO rules

English keeps its root URLs. Non-English uses `/{segment}/` and `/{segment}/{route}/` with trailing slashes. Reviewed pages have self-referencing canonicals, reciprocal hreflang links, an equivalent English `x-default`, localized metadata/structured data, and appear once in the sitemap. Draft and disabled pages use noindex,follow and never appear in the production sitemap or hreflang cluster. Validate route registry, sitemap, canonicals, reciprocal hreflang, `lang`, `dir`, and generated output before publishing.

Submit the reviewed sitemap in Google Search Console and Bing Webmaster Tools, monitor Yandex Webmaster where relevant, inspect representative URLs, monitor crawl errors and duplicate-content reports, and validate hreflang reciprocals. Use native-language keyword research, native translation quality review, localized backlinks, local publications, and relevant directories. Never add fake verification tokens.

## Selector and suggestion behavior

The language selector uses native names and routes to the equivalent public path. It never preserves payment secrets, entitlement tokens, scan or report data, email, receipt references, or workflow data. Draft locales are visibly marked Draft, not presented as approved checkout languages. Checkout and payment-return routes are not automatically switched.

Preference order is explicit selection, saved `solvelang_locale`, `navigator.languages`, optional country hint, then English. A language suggestion is optional and non-blocking; it does not redirect, does not change contract language, and can be dismissed for the current session.

## Review checklist

Before a locale becomes reviewed: verify all visible copy, metadata, Open Graph/Twitter, FAQ, breadcrumbs, structured data `inLanguage`, alt text, accessibility labels, RTL behavior where applicable, and native-language search terms. Before checkout: obtain separate approval for Terms, Refund Policy, Privacy, Withdrawal wording, immediate-performance consent, withdrawal acknowledgement, price and tax wording, payment button, support and complaint procedures, and contract confirmation wording. Machine translation is never legal approval.
