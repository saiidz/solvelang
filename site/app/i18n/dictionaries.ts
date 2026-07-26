import { locales, type LocaleCode } from "./locales";

export const technicalTerms = ["SolveLang", "n8n", "Stripe", "AWS", "Cloudflare", "GitHub", "JSON", "PaymentIntent", "Workflow Preflight", "USD $49"] as const;

export const requiredDictionaryKeys = [
  "home", "support", "terms", "refundPolicy", "privacy", "withdraw", "checkout", "check", "draftNotice", "language", "continueEnglish", "checkoutUnavailable", "paymentSummary", "payButton", "notFoundTitle", "notFoundBody", "contact", "noSubscription", "automatedReport", "withdrawal", "accessibilityLanguageSelector",
] as const;

export type Dictionary = Record<(typeof requiredDictionaryKeys)[number], string>;

const english: Dictionary = {
  home: "Home", support: "Support", terms: "Terms of Use", refundPolicy: "Refund Policy", privacy: "Privacy", withdraw: "Withdrawal request", checkout: "Checkout", check: "Workflow Preflight", draftNotice: "This translation is a draft and is not a contract language or an approved checkout experience.", language: "Language", continueEnglish: "Continue in English", checkoutUnavailable: "Checkout is available in English only while this translation is awaiting marketing, legal, and checkout review.", paymentSummary: "One-time payment: USD $49. No subscription. Automated digital report.", payButton: "Pay USD $49 and start Workflow Preflight", notFoundTitle: "Page not found", notFoundBody: "The requested public page is not available in this language.", contact: "Contact support", noSubscription: "No subscription", automatedReport: "Automated digital report", withdrawal: "Withdrawal requests are reviewed under applicable law.", accessibilityLanguageSelector: "Choose language",
};

// Draft values are deliberately not treated as reviewed translations. They are complete
// dictionary-shaped content so build-time key validation catches missing product copy.
export const dictionaries: Record<LocaleCode, Dictionary> = Object.fromEntries(
  locales.map((locale) => [locale.code, locale.code === "en" ? english : { ...english, draftNotice: `${locale.nativeName}: ${english.draftNotice}` }]),
) as Record<LocaleCode, Dictionary>;

export function dictionaryFor(locale: LocaleCode): Dictionary {
  const dictionary = dictionaries[locale];
  for (const key of requiredDictionaryKeys) {
    if (!dictionary[key]) throw new Error(`Missing translation key ${key} for ${locale}.`);
  }
  return dictionary;
}
