import { locales, reviewedLocales, type LocaleCode } from "./locales";

export const localeStorageKey = "solvelang_locale";
export const suggestionDismissedStorageKey = "solvelang_locale_suggestion_dismissed";

const countryCandidates: Record<string, readonly LocaleCode[]> = {
  BR: ["pt-BR"], CN: ["zh-Hans"], TW: ["zh-Hant"], HK: ["zh-Hant", "en"],
  CA: ["en", "fr"], BE: ["nl", "fr", "de"], CH: ["de", "fr", "it"], LU: ["fr", "de"],
  FI: ["fi", "sv"], CY: ["el", "tr"], IL: ["he", "ar"], LB: ["ar", "fr", "en"],
  IN: ["hi", "en"], ZA: ["en"], SG: ["en", "zh-Hans"], MY: ["en", "id"], AE: ["ar", "en"],
  RO: ["ro"], FR: ["fr"], DE: ["de"], ES: ["es"], IT: ["it"], NL: ["nl"], PL: ["pl"],
  CZ: ["cs"], TR: ["tr"], RU: ["ru"], UA: ["uk"], JP: ["ja"], KR: ["ko"], ID: ["id"],
  VN: ["vi"], TH: ["th"], SE: ["sv"], DK: ["da"], NO: ["no"], GR: ["el"],
};

export function storedLocale(value: string | null): LocaleCode | undefined {
  return value && reviewedLocales.some((locale) => locale.code === value) ? value as LocaleCode : undefined;
}

export function browserLocale(languages: readonly string[]): LocaleCode | undefined {
  for (const value of languages) {
    const lower = value.toLowerCase();
    const parts = lower.split("-");
    if (parts[0] === "zh") {
      if (parts.includes("hans")) return "zh-Hans";
      if (parts.includes("hant")) return "zh-Hant";
      const region = parts.find((part) => part.length === 2 && part !== "zh");
      if (region === "cn" || region === "sg") return "zh-Hans";
      if (region === "tw" || region === "hk" || region === "mo") return "zh-Hant";
    }
    const exact = locales.find((locale) => locale.code.toLowerCase() === lower);
    if (exact) return exact.code as LocaleCode;
    const base = lower.split("-")[0];
    const matched = locales.find((locale) => locale.code.toLowerCase() === base);
    if (matched) return matched.code as LocaleCode;
  }
  return undefined;
}

export function validateCountryHint(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length !== 1 || entries[0][0] !== "country") return undefined;
  return typeof entries[0][1] === "string" && /^[A-Z]{2}$/.test(entries[0][1]) ? entries[0][1] : undefined;
}

export function suggestedLocale({ explicit, saved, browser, country }: { explicit?: LocaleCode; saved?: LocaleCode; browser?: LocaleCode; country?: string }): LocaleCode {
  const published = (candidate?: LocaleCode) => candidate && reviewedLocales.some((locale) => locale.code === candidate) ? candidate : undefined;
  if (published(explicit)) return explicit!;
  if (published(saved)) return saved!;
  if (published(browser)) return browser!;
  const candidates = country ? countryCandidates[country] : undefined;
  return candidates?.map(published).find(Boolean) ?? "en";
}

export async function fetchCountryHint(endpoint: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  if (!endpoint) return undefined;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetchImpl(endpoint, { method: "GET", credentials: "omit", signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) return undefined;
    return validateCountryHint(await response.json());
  } catch {
    return undefined;
  } finally {
    window.clearTimeout(timeout);
  }
}
