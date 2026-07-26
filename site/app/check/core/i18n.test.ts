import assert from "node:assert/strict";
import test from "node:test";
import { dictionaries, dictionaryFor, requiredDictionaryKeys, technicalTerms } from "../../i18n/dictionaries";
import { defaultLocale, locales, reviewedLocales } from "../../i18n/locales";
import { browserLocale, storedLocale, suggestedLocale, validateCountryHint } from "../../i18n/preference";
import { normalisePublicRoute, pathForLocale, publicRouteSegments, safeLocalePath } from "../../i18n/routes";

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

test("dictionaries are complete and technical terms are explicitly allowlisted", () => {
  assert.ok(technicalTerms.includes("PaymentIntent"));
  for (const locale of locales) {
    const dictionary = dictionaryFor(locale.code as never);
    assert.deepEqual(Object.keys(dictionary).sort(), [...requiredDictionaryKeys].sort());
    assert.deepEqual(dictionaries[locale.code as never], dictionary);
  }
});

test("static routes preserve English roots and generate all draft locale paths", () => {
  assert.equal(pathForLocale(defaultLocale, ""), "/");
  assert.equal(pathForLocale(defaultLocale, "support"), "/support");
  const french = locales.find((locale) => locale.code === "fr")!;
  assert.equal(pathForLocale(french, "support"), "/fr/support/");
  assert.equal(locales.filter((locale) => locale.code !== "en").length * publicRouteSegments.length, 216);
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
  assert.equal(storedLocale("fr"), "fr");
  assert.equal(storedLocale("fr-FR"), undefined);
  assert.equal(browserLocale(["fr-CA", "en"]), "fr");
  assert.equal(suggestedLocale({ explicit: "de", saved: "fr", browser: "ro", country: "BR" }), "de");
  assert.equal(suggestedLocale({ saved: "fr", browser: "ro", country: "BR" }), "fr");
  assert.equal(suggestedLocale({ browser: "ro", country: "BR" }), "ro");
  assert.equal(suggestedLocale({ country: "BR" }), "pt-BR");
  assert.equal(suggestedLocale({ country: "CA" }), "en");
  assert.equal(validateCountryHint({ country: "FR" }), "FR");
  assert.equal(validateCountryHint({ country: "fr" }), undefined);
  assert.equal(validateCountryHint({ country: "FR", city: "Paris" }), undefined);
  assert.equal(validateCountryHint({ city: "Paris" }), undefined);
});
