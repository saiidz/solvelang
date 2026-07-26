"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { localeByCode, localeForSegment } from "../i18n/locales";
import { fetchCountryHint, browserLocale, localeStorageKey, storedLocale, suggestedLocale, suggestionDismissedStorageKey } from "../i18n/preference";
import { safeLocalePath, isPaymentSensitiveRoute, normalisePublicRoute } from "../i18n/routes";

export function LanguageSuggestion({ countryHintEndpoint = "" }: { countryHintEndpoint?: string }) {
  const pathname = usePathname();
  const [suggestion, setSuggestion] = useState<string>();
  useEffect(() => {
    const parts = pathname.split("/").filter(Boolean);
    const currentLocale = localeForSegment(parts[0]);
    const route = normalisePublicRoute(currentLocale ? parts.slice(1) : parts);
    if (route === undefined || isPaymentSensitiveRoute(route) || sessionStorage.getItem(suggestionDismissedStorageKey)) return;
    const savedValue = localStorage.getItem(localeStorageKey);
    const saved = storedLocale(savedValue);
    if (savedValue && !saved) localStorage.removeItem(localeStorageKey);
    const browser = browserLocale(navigator.languages);
    void fetchCountryHint(countryHintEndpoint).then((country) => {
      const selected = suggestedLocale({ saved, browser, country });
      if (selected !== "en") setSuggestion(selected);
    });
  }, [countryHintEndpoint, pathname]);
  if (!suggestion) return null;
  const locale = localeByCode.get(suggestion);
  if (!locale) return null;
  return <aside role="status" className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-4 shadow-lg" aria-label="Optional language suggestion">
    <p className="text-sm text-slate-800">Would you like to view SolveLang in {locale.nativeName}? This suggestion is optional.</p>
    <div className="mt-3 flex gap-3"><button type="button" className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => { localStorage.setItem(localeStorageKey, locale.code); window.location.assign(safeLocalePath(locale, pathname)); }}>Switch to {locale.nativeName}</button><button type="button" className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={() => { sessionStorage.setItem(suggestionDismissedStorageKey, "1"); setSuggestion(undefined); }}>Continue in English</button></div>
  </aside>;
}
