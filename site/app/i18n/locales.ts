export const publicationStates = ["reviewed", "draft", "disabled"] as const;
export const reviewStates = ["reviewed", "pending", "not-applicable"] as const;

export type PublicationState = (typeof publicationStates)[number];
export type ReviewState = (typeof reviewStates)[number];

export type LocaleDefinition = {
  code: string;
  hreflang: string;
  segment: string;
  englishName: string;
  nativeName: string;
  direction: "ltr" | "rtl";
  publicationState: PublicationState;
  translationRevision: number;
  marketingReview: ReviewState;
  legalReview: ReviewState;
  checkoutTranslationReview: ReviewState;
  checkoutEnabled: boolean;
  reviewer: string;
  lastReviewed?: string;
};

const draft = {
  publicationState: "draft" as const,
  translationRevision: 1,
  marketingReview: "pending" as const,
  legalReview: "pending" as const,
  checkoutTranslationReview: "pending" as const,
  checkoutEnabled: false,
  reviewer: "Human review required",
};

export const locales = [
  { code: "en", hreflang: "en", segment: "en", englishName: "English", nativeName: "English", direction: "ltr", publicationState: "reviewed", translationRevision: 1, marketingReview: "reviewed", legalReview: "reviewed", checkoutTranslationReview: "reviewed", checkoutEnabled: false, reviewer: "SolveLang editorial", lastReviewed: "2026-07-26" },
  { code: "ro", hreflang: "ro", segment: "ro", englishName: "Romanian", nativeName: "Română", direction: "ltr", ...draft },
  { code: "fr", hreflang: "fr", segment: "fr", englishName: "French", nativeName: "Français", direction: "ltr", ...draft },
  { code: "de", hreflang: "de", segment: "de", englishName: "German", nativeName: "Deutsch", direction: "ltr", ...draft },
  { code: "es", hreflang: "es", segment: "es", englishName: "Spanish", nativeName: "Español", direction: "ltr", ...draft },
  { code: "it", hreflang: "it", segment: "it", englishName: "Italian", nativeName: "Italiano", direction: "ltr", ...draft },
  { code: "pt-BR", hreflang: "pt-BR", segment: "pt-br", englishName: "Brazilian Portuguese", nativeName: "Português (Brasil)", direction: "ltr", ...draft },
  { code: "nl", hreflang: "nl", segment: "nl", englishName: "Dutch", nativeName: "Nederlands", direction: "ltr", ...draft },
  { code: "pl", hreflang: "pl", segment: "pl", englishName: "Polish", nativeName: "Polski", direction: "ltr", ...draft },
  { code: "cs", hreflang: "cs", segment: "cs", englishName: "Czech", nativeName: "Čeština", direction: "ltr", ...draft },
  { code: "tr", hreflang: "tr", segment: "tr", englishName: "Turkish", nativeName: "Türkçe", direction: "ltr", ...draft },
  { code: "ar", hreflang: "ar", segment: "ar", englishName: "Arabic", nativeName: "العربية", direction: "rtl", ...draft },
  { code: "he", hreflang: "he", segment: "he", englishName: "Hebrew", nativeName: "עברית", direction: "rtl", ...draft },
  { code: "ru", hreflang: "ru", segment: "ru", englishName: "Russian", nativeName: "Русский", direction: "ltr", ...draft },
  { code: "uk", hreflang: "uk", segment: "uk", englishName: "Ukrainian", nativeName: "Українська", direction: "ltr", ...draft },
  { code: "zh-Hans", hreflang: "zh-Hans", segment: "zh-hans", englishName: "Simplified Chinese", nativeName: "简体中文", direction: "ltr", ...draft },
  { code: "zh-Hant", hreflang: "zh-Hant", segment: "zh-hant", englishName: "Traditional Chinese", nativeName: "繁體中文", direction: "ltr", ...draft },
  { code: "ja", hreflang: "ja", segment: "ja", englishName: "Japanese", nativeName: "日本語", direction: "ltr", ...draft },
  { code: "ko", hreflang: "ko", segment: "ko", englishName: "Korean", nativeName: "한국어", direction: "ltr", ...draft },
  { code: "hi", hreflang: "hi", segment: "hi", englishName: "Hindi", nativeName: "हिन्दी", direction: "ltr", ...draft },
  { code: "id", hreflang: "id", segment: "id", englishName: "Indonesian", nativeName: "Bahasa Indonesia", direction: "ltr", ...draft },
  { code: "vi", hreflang: "vi", segment: "vi", englishName: "Vietnamese", nativeName: "Tiếng Việt", direction: "ltr", ...draft },
  { code: "th", hreflang: "th", segment: "th", englishName: "Thai", nativeName: "ไทย", direction: "ltr", ...draft },
  { code: "sv", hreflang: "sv", segment: "sv", englishName: "Swedish", nativeName: "Svenska", direction: "ltr", ...draft },
  { code: "da", hreflang: "da", segment: "da", englishName: "Danish", nativeName: "Dansk", direction: "ltr", ...draft },
  { code: "no", hreflang: "no", segment: "no", englishName: "Norwegian", nativeName: "Norsk", direction: "ltr", ...draft },
  { code: "fi", hreflang: "fi", segment: "fi", englishName: "Finnish", nativeName: "Suomi", direction: "ltr", ...draft },
  { code: "el", hreflang: "el", segment: "el", englishName: "Greek", nativeName: "Ελληνικά", direction: "ltr", ...draft },
] as const satisfies readonly LocaleDefinition[];

export type LocaleCode = (typeof locales)[number]["code"];

export const defaultLocale = locales[0];
export const reviewedLocales = locales.filter((locale) => locale.publicationState === "reviewed");
export const publishedLocales = reviewedLocales;
export const localeBySegment = new Map<string, LocaleDefinition>(locales.map((locale) => [locale.segment, locale]));
export const localeByCode = new Map<string, LocaleDefinition>(locales.map((locale) => [locale.code, locale]));

export function localeForSegment(segment: string | undefined): LocaleDefinition | undefined {
  return segment ? localeBySegment.get(segment) : undefined;
}

export function isCheckoutApproved(locale: LocaleDefinition): boolean {
  return locale.publicationState === "reviewed"
    && locale.marketingReview === "reviewed"
    && locale.legalReview === "reviewed"
    && locale.checkoutTranslationReview === "reviewed"
    && locale.checkoutEnabled;
}
