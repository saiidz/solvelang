import assert from "node:assert/strict";
import test from "node:test";
import { dictionaries, dictionaryFor, requiredDictionaryKeys, technicalTerms, validateReviewedDictionary } from "../../i18n/dictionaries";
import { defaultLocale, locales, publishedLocales, reviewedLocales } from "../../i18n/locales";
import { browserLocale, storedLocale, suggestedLocale, validateCountryHint } from "../../i18n/preference";
import {
  canApplyLanguageSuggestion,
  isLanguageSuggestionEligiblePath,
  localizableRoutes,
  normalisePublicRoute,
  pathForLocale,
  productionLocalizedParams,
  publicRoutes,
  safeLocalePath,
} from "../../i18n/routes";
import { alternatesForRoute, sitemapEntries } from "../../i18n/seo";

test("locale registry has unique valid static route and hreflang definitions", () => {
  assert.equal(locales.length, 28);
  assert.equal(new Set(locales.map((locale) => locale.segment)).size, locales.length);
  assert.equal(new Set(locales.map((locale) => locale.hreflang)).size, locales.length);
  for (const locale of locales) {
    assert.match(locale.code, /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/);
    assert.match(locale.segment, /^[a-z0-9-]+$/);
    assert.ok(["ltr", "rtl"].includes(locale.direction));
    assert.ok(["reviewed", "draft", "disabled"].includes(locale.publicationState));
  }
  assert.equal(locales.find((locale) => locale.code === "ar")?.direction, "rtl");
  assert.equal(locales.find((locale) => locale.code === "he")?.direction, "rtl");
  assert.notEqual(locales.find((locale) => locale.code === "zh-Hans")?.segment, locales.find((locale) => locale.code === "zh-Hant")?.segment);
  assert.notEqual(locales.find((locale) => locale.code === "pt-BR")?.segment, "pt");
});

test("only English is reviewed and every non-English locale remains a no-checkout draft", () => {
  assert.deepEqual(reviewedLocales.map((locale) => locale.code), ["en"]);
  for (const locale of locales.filter((locale) => locale.code !== "en")) {
    assert.equal(locale.publicationState, "draft");
    assert.equal(locale.checkoutEnabled, false);
    assert.notEqual(locale.legalReview, "reviewed");
  }
});

test("only reviewed dictionaries must be complete and non-placeholder", () => {
  assert.ok(technicalTerms.includes("PaymentIntent"));
  assert.deepEqual(Object.keys(dictionaryFor("en")).sort(), [...requiredDictionaryKeys].sort());
  assert.equal(dictionaries.fr, undefined);
  assert.doesNotThrow(() => validateReviewedDictionary("en", dictionaries.en));
  assert.throws(() => validateReviewedDictionary("fr", { ...dictionaries.en }), /English placeholder/);
  assert.throws(() => validateReviewedDictionary("fr", { home: "Accueil" }), /Missing translation key/);
});

test("production generates no draft locale routes and preview remains explicit", () => {
  assert.equal(pathForLocale(defaultLocale, ""), "/");
  assert.equal(pathForLocale(defaultLocale, "support"), "/support/");
  const french = locales.find((locale) => locale.code === "fr")!;
  assert.equal(pathForLocale(french, "support"), "/fr/support/");
  assert.deepEqual(productionLocalizedParams(false), []);
  assert.equal(productionLocalizedParams(true).length, 27 * localizableRoutes.length);
  assert.equal(normalisePublicRoute(["terms"]), "terms");
  assert.equal(normalisePublicRoute(["invalid"]), undefined);
});

test("route switching preserves context but rejects payment and private query values", () => {
  const french = locales.find((locale) => locale.code === "fr")!;
  const query = new URLSearchParams("ref=docs&client_secret=secret&payment_intent=pi_private&email=buyer@example.test");
  assert.equal(safeLocalePath(french, "/support/", query), "/fr/support/?ref=docs");
  assert.equal(safeLocalePath(french, "/checkout/", query), "/fr/checkout/?ref=docs");
});

test("language preference order and country hint validation are deterministic and privacy-minimal", () => {
  assert.equal(storedLocale("fr"), undefined);
  assert.equal(storedLocale("fr-FR"), undefined);
  assert.equal(browserLocale(["fr-CA", "en"]), "fr");
  assert.equal(suggestedLocale({ explicit: "de", saved: "fr", browser: "ro", country: "BR" }), "en");
  assert.equal(suggestedLocale({ saved: "fr", browser: "ro", country: "BR" }), "en");
  assert.equal(suggestedLocale({ browser: "ro", country: "BR" }), "en");
  assert.equal(suggestedLocale({ country: "BR" }), "en");
  assert.equal(suggestedLocale({ country: "CA" }), "en");
  assert.equal(validateCountryHint({ country: "FR" }), "FR");
  assert.equal(validateCountryHint({ country: "fr" }), undefined);
  assert.equal(validateCountryHint({ country: "FR", city: "Paris" }), undefined);
  assert.equal(validateCountryHint({ city: "Paris" }), undefined);
});

test("Chinese browser locale aliases honor explicit scripts before region mappings", () => {
  assert.equal(browserLocale(["zh-CN"]), "zh-Hans");
  assert.equal(browserLocale(["zh-SG"]), "zh-Hans");
  assert.equal(browserLocale(["zh-TW"]), "zh-Hant");
  assert.equal(browserLocale(["zh-HK"]), "zh-Hant");
  assert.equal(browserLocale(["zh-MO"]), "zh-Hant");
  assert.equal(browserLocale(["zh-Hant-CN"]), "zh-Hant");
  assert.equal(browserLocale(["zh-Hans-TW"]), "zh-Hans");
  assert.equal(suggestedLocale({ browser: browserLocale(["zh-CN"]) }), "en");
  assert.equal(suggestedLocale({ browser: browserLocale(["zh-TW"]) }), "en");
});

test("language suggestions clear on sensitive routes and ignore stale navigation responses", () => {
  assert.equal(isLanguageSuggestionEligiblePath("/support/"), true);
  assert.equal(isLanguageSuggestionEligiblePath("/check/"), false);
  assert.equal(isLanguageSuggestionEligiblePath("/checkout/"), false);
  assert.equal(isLanguageSuggestionEligiblePath("/success/"), false);
  assert.equal(isLanguageSuggestionEligiblePath("/run/"), false);
  assert.equal(canApplyLanguageSuggestion("/support/", "/support/"), true);
  assert.equal(canApplyLanguageSuggestion("/support/", "/checkout/"), false);
  assert.equal(canApplyLanguageSuggestion("/about/", "/check/"), false);
});

test("hreflang is route-specific, self-referencing, reciprocal, and excludes drafts", () => {
  const english = alternatesForRoute("support");
  assert.equal(english.canonical, "https://www.solve-lang.com/support/");
  assert.deepEqual(english.languages, {
    en: "https://www.solve-lang.com/support/",
    "x-default": "https://www.solve-lang.com/support/",
  });
  const frenchReviewed = locales.map((locale) => locale.code === "fr" ? { ...locale, publicationState: "reviewed" as const } : locale);
  const en = alternatesForRoute("support", frenchReviewed);
  const fr = alternatesForRoute("support", frenchReviewed, "fr");
  assert.equal(en.languages.fr, fr.canonical);
  assert.equal(fr.languages.en, en.canonical);
  assert.equal(fr.languages["x-default"], en.canonical);
});

test("sitemap is generated from the complete classified public route registry", () => {
  const entries = sitemapEntries();
  assert.equal(entries.length, publicRoutes.filter((route) => route.sitemap).length);
  assert.equal(new Set(entries.map((entry) => entry.url)).size, entries.length);
  assert.ok(entries.some((entry) => entry.url === "https://www.solve-lang.com/support/"));
  assert.ok(!entries.some((entry) => entry.url.includes("/fr/")));
  assert.deepEqual(publishedLocales.map((locale) => locale.code), ["en"]);
});
