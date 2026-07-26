"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { localeByCode } from "../i18n/locales";
import { fetchCountryHint, browserLocale, localeStorageKey, storedLocale, suggestedLocale, suggestionDismissedStorageKey } from "../i18n/preference";
import { pathForLocale, isPaymentSensitiveRoute, normalisePublicRoute } from "../i18n/routes";

const endpoint = process.env.NEXT_PUBLIC_COUNTRY_HINT_ENDPOINT ?? "";

export function LanguageSuggestion() {
  const pathname = usePathname();
  const [suggestion, setSuggestion] = useState<string>();
  useEffect(() => {
    const route = normalisePublicRoute(pathname.split("/").filter(Boolean));
    if (route === undefined || isPaymentSensitiveRoute(route) || sessionStorage.getItem(suggestionDismissedStorageKey)) return;
    const saved = storedLocale(localStorage.getItem(localeStorageKey));
    const browser = browserLocale(navigator.languages);
    void fetchCountryHint(endpoint).then((country) => {
      const selected = suggestedLocale({ saved, browser, country });
      if (selected !== "en") setSuggestion(selected);
    });
  }, [pathname]);
  if (!suggestion) return null;
  const locale = localeByCode.get(suggestion);
  if (!locale) return null;
  return <aside role="status" className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-4 shadow-lg" aria-label="Optional language suggestion">
    <p className="text-sm text-slate-800">Would you like to view SolveLang in {locale.nativeName}? This suggestion is optional.</p>
    <div className="mt-3 flex gap-3"><button type="button" className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => { localStorage.setItem(localeStorageKey, locale.code); window.location.assign(pathForLocale(locale, "")); }}>Switch to {locale.nativeName}</button><button type="button" className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={() => { sessionStorage.setItem(suggestionDismissedStorageKey, "1"); setSuggestion(undefined); }}>Continue in English</button></div>
  </aside>;
}
