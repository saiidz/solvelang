import { locales, type LocaleCode } from "./locales";

export const technicalTerms = ["SolveLang", "n8n", "Stripe", "AWS", "Cloudflare", "GitHub", "JSON", "PaymentIntent", "Workflow Preflight", "USD $49"] as const;

export const requiredDictionaryKeys = [
  "home", "support", "terms", "refundPolicy", "privacy", "withdraw", "checkout", "check", "draftNotice", "language", "continueEnglish", "checkoutUnavailable", "paymentSummary", "payButton", "notFoundTitle", "notFoundBody", "contact", "noSubscription", "automatedReport", "withdrawal", "accessibilityLanguageSelector",
] as const;

export type Dictionary = Record<(typeof requiredDictionaryKeys)[number], string>;
export type DraftDictionary = Partial<Dictionary>;

const english: Dictionary = {
  home: "Home", support: "Support", terms: "Terms of Use", refundPolicy: "Refund Policy", privacy: "Privacy", withdraw: "Withdrawal request", checkout: "Checkout", check: "Workflow Preflight", draftNotice: "This translation is a draft and is not a contract language or an approved checkout experience.", language: "Language", continueEnglish: "Continue in English", checkoutUnavailable: "Checkout is available in English only while this translation is awaiting marketing, legal, and checkout review.", paymentSummary: "One-time payment: USD $49. No subscription. Automated digital report.", payButton: "Pay USD $49 and start Workflow Preflight", notFoundTitle: "Page not found", notFoundBody: "The requested public page is not available in this language.", contact: "Contact support", noSubscription: "No subscription", automatedReport: "Automated digital report", withdrawal: "Withdrawal requests are reviewed under applicable law.", accessibilityLanguageSelector: "Choose language",
};

export const dictionaries: Partial<Record<LocaleCode, DraftDictionary>> & { en: Dictionary } = {
  en: english,
};

export function dictionaryFor(locale: LocaleCode): Dictionary {
  const dictionary = dictionaries[locale];
  const definition = locales.find((candidate) => candidate.code === locale);
  if (definition?.publicationState !== "reviewed") {
    return {
      ...english,
      ...dictionary,
      draftNotice: `${definition?.nativeName ?? locale}: Internal draft preview. English fallback is shown for review only and is not an approved translation or contract language.`,
      checkoutUnavailable: "Checkout is disabled in draft preview. Continue in English to use Workflow Preflight.",
    };
  }
  validateReviewedDictionary(locale, dictionary);
  return dictionary as Dictionary;
}

export function validateReviewedDictionary(locale: LocaleCode, dictionary: DraftDictionary | undefined): asserts dictionary is Dictionary {
  for (const key of requiredDictionaryKeys) {
    const value = dictionary?.[key]?.trim();
    if (!value) throw new Error(`Missing translation key ${key} for ${locale}.`);
    if (locale !== "en" && value === english[key] && !technicalTerms.some((term) => value === term)) {
      throw new Error(`English placeholder content in ${key} for reviewed locale ${locale}.`);
    }
  }
}
