"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { LanguageSelector } from "./LanguageSelector";
import { SiteAccountMenu } from "./SiteAccountMenu";
import { defaultLocale } from "../i18n/locales";
import { isCurrentLink, normalizePath, primaryLinks, toolLinks } from "./site-navigation";

export function SiteHeader() {
  const pathname = usePathname();
  const header = useRef<HTMLElement>(null);
  const route = normalizePath(pathname);

  useEffect(() => {
    const element = header.current;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !element?.contains(event.target)) {
        element?.querySelectorAll("details[open]").forEach((menu) => menu.removeAttribute("open"));
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  function closeMenus() {
    header.current?.querySelectorAll("details[open]").forEach((menu) => menu.removeAttribute("open"));
  }

  function linkClass(href: string, mobile = false) {
    return `${mobile ? "block rounded-xl px-4 py-3" : "rounded-lg px-2 py-2"} text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${isCurrentLink(pathname, href) ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100 hover:text-slate-950"}`;
  }

  return (
    <header
      ref={header}
      data-site-header="true"
      className="sticky top-0 z-50 shrink-0 border-b border-slate-200 bg-white text-slate-950"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        const menu = header.current?.querySelector<HTMLDetailsElement>("details[open]");
        if (menu) {
          menu.open = false;
          menu.querySelector<HTMLElement>("summary")?.focus();
          event.preventDefault();
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) closeMenus();
      }}
    >
      <a href="#site-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-slate-950 focus:px-4 focus:py-3 focus:text-white">Skip to content</a>
      <nav aria-label="Primary navigation" className="mx-auto flex min-h-18 max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" aria-label="SolveLang home" onClick={closeMenus} className="shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">
          <Image src="/solvelang-logo.svg" alt="SolveLang" width={194} height={41} className="h-auto w-32 sm:w-40" priority />
        </Link>
        <div className="hidden items-center gap-1 xl:flex">
          {primaryLinks.map(({ label, href }) => (
            <Link key={href} href={href} aria-current={isCurrentLink(pathname, href) ? "page" : undefined} className={linkClass(href)}>{label}</Link>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <SiteAccountMenu />
          <div className="hidden sm:block"><Suspense fallback={<span className="inline-block w-12" />}><LanguageSelector current={defaultLocale} /></Suspense></div>
          <details key={route} className="group relative" data-site-menu="true">
            <summary className="cursor-pointer list-none whitespace-nowrap rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden">
              <span className="xl:hidden">Menu</span><span className="hidden xl:inline">More</span><span aria-hidden="true" className="ml-2">▾</span>
            </summary>
            <div className="absolute right-0 top-full mt-3 max-h-[calc(100dvh-6rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
              <div className="xl:hidden">
                <Link href="/" onClick={closeMenus} className={linkClass("/", true)} aria-current={normalizePath(pathname) === "/" ? "page" : undefined}>Home</Link>
                {primaryLinks.map(({ label, href }) => (
                  <Link key={href} href={href} onClick={closeMenus} aria-current={isCurrentLink(pathname, href) ? "page" : undefined} className={linkClass(href, true)}>{label}</Link>
                ))}
                <hr className="my-2 border-slate-200" />
              </div>
              {toolLinks.map(({ label, href }) => (
                <Link key={href} href={href} onClick={closeMenus} aria-current={isCurrentLink(pathname, href) ? "page" : undefined} className={linkClass(href, true)}>{label}</Link>
              ))}
              <a href="https://github.com/saiidz/solvelang" className={linkClass("/source", true)} target="_blank" rel="noreferrer">GitHub ↗</a>
              <div className="px-4 py-2 sm:hidden"><Suspense fallback={<span>English</span>}><LanguageSelector current={defaultLocale} /></Suspense></div>
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}
