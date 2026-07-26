"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { locales, type LocaleDefinition } from "../i18n/locales";
import { safeLocalePath } from "../i18n/routes";

export function LanguageSelector({ current }: { current: LocaleDefinition }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <details className="relative text-sm">
      <summary className="cursor-pointer list-none rounded-lg px-2 py-1.5 font-semibold text-slate-700 hover:bg-slate-100" aria-label="Choose language">
        {current.nativeName}
      </summary>
      <div className="absolute right-0 z-50 mt-2 max-h-80 w-64 overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-xl" role="menu" aria-label="Language">
        {locales.map((locale) => {
          const path = safeLocalePath(locale, pathname, new URLSearchParams(searchParams.toString()));
          const isCurrent = locale.code === current.code;
          return locale.publicationState === "reviewed" ? (
            <Link key={locale.code} role="menuitem" aria-current={isCurrent ? "page" : undefined} href={path} className="block rounded px-3 py-2 text-slate-800 hover:bg-slate-100">
              {locale.nativeName}
            </Link>
          ) : (
            <span key={locale.code} role="menuitem" aria-disabled="true" className="block rounded px-3 py-2 text-slate-400">
              {locale.nativeName} <span className="text-xs">(Draft)</span>
            </span>
          );
        })}
      </div>
    </details>
  );
}
