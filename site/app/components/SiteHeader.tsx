"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { LanguageSelector } from "./LanguageSelector";
import { defaultLocale } from "../i18n/locales";
import { isCurrentLink, normalizePath, primaryLinks, toolLinks } from "./site-navigation";
import {
  CustomerApiError,
  type CustomerDashboard,
  customerApi,
  customerSessionChangedEvent,
  normalizeApiBase,
} from "../account/core/customer-api";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);

export function SiteHeader() {
  const pathname = usePathname();
  const header = useRef<HTMLElement>(null);
  const route = normalizePath(pathname);
  const [account, setAccount] = useState<CustomerDashboard | null>(null);
  const [sessionState, setSessionState] = useState<"loading" | "signed-in" | "signed-out" | "unavailable">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!API_BASE) {
      setAccount(null);
      setSessionState("signed-out");
      return;
    }
    try {
      const current = await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
      setAccount(current);
      setError("");
      setSessionState("signed-in");
    } catch (caught) {
      setAccount(null);
      setSessionState(caught instanceof CustomerApiError && caught.status === 401 ? "signed-out" : "unavailable");
    }
  }, []);

  useEffect(() => {
    // The initial request reconciles client state with the server-owned session cookie.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const refreshOnFocus = () => { void refresh(); };
    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener(customerSessionChangedEvent, refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener(customerSessionChangedEvent, refreshOnFocus);
    };
  }, [refresh]);

  async function signOut() {
    if (!account || busy) return;
    setBusy(true);
    setError("");
    try {
      await customerApi(API_BASE, "/customer/auth/logout", {
        method: "POST",
        csrfToken: account.csrfToken,
      });
      window.location.reload();
    } catch (caught) {
      if (caught instanceof CustomerApiError && caught.status === 401) {
        window.location.reload();
        return;
      }
      setError("Sign out failed. Your account is still signed in.");
      setBusy(false);
    }
  }

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

  const label = account?.email || account?.auth.username || "your account";
  const signedIn = sessionState === "signed-in" && account;

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
          {primaryLinks.map(({ label: linkLabel, href }) => (
            <Link key={href} href={href} aria-current={isCurrentLink(pathname, href) ? "page" : undefined} className={linkClass(href)}>{linkLabel}</Link>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <div className="hidden sm:block"><Suspense fallback={<span className="inline-block w-12" />}><LanguageSelector current={defaultLocale} /></Suspense></div>
          <details key={route} className="group relative" data-site-menu="true">
            <summary className="cursor-pointer list-none whitespace-nowrap rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden">
              Menu<span aria-hidden="true" className="ml-2">▾</span>
            </summary>
            <div className="absolute right-0 top-full mt-3 max-h-[calc(100dvh-6rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
              {sessionState === "loading" ? (
                <p className="px-4 py-3 text-sm font-semibold text-slate-500">Checking account status…</p>
              ) : signedIn ? (
                <>
                  <div className="border-b border-slate-200 px-4 pb-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Signed in as</p>
                    <p className="mt-1 break-all text-sm font-semibold">{label}</p>
                  </div>
                  {error ? <p role="alert" className="px-4 pt-3 text-sm text-red-700">{error}</p> : null}
                  <Link href="/account/" onClick={closeMenus} className={linkClass("/account/", true)}>Account home</Link>
                  <Link href="/account/api-keys/" onClick={closeMenus} className={linkClass("/account/api-keys/", true)}>API account</Link>
                  <Link href="/account/live-center/" onClick={closeMenus} className={linkClass("/account/live-center/", true)}>Live Center</Link>
                  <Link href="/account/runner-minutes-checkout/" onClick={closeMenus} className={linkClass("/account/runner-minutes-checkout/", true)}>Buy minutes</Link>
                  <hr className="my-2 border-slate-200" />
                </>
              ) : (
                <>
                  <Link href="/account/api-keys/" onClick={closeMenus} aria-label={sessionState === "signed-out" ? "Sign in to your account" : "Account status unavailable; open account"} className={linkClass("/account/api-keys/", true)}>Sign in</Link>
                  <hr className="my-2 border-slate-200" />
                </>
              )}
              <Link href="/" onClick={closeMenus} className={linkClass("/", true)} aria-current={normalizePath(pathname) === "/" ? "page" : undefined}>Home</Link>
              {primaryLinks.map(({ label: linkLabel, href }) => (
                <Link key={href} href={href} onClick={closeMenus} aria-current={isCurrentLink(pathname, href) ? "page" : undefined} className={linkClass(href, true)}>{linkLabel}</Link>
              ))}
              <hr className="my-2 border-slate-200" />
              {toolLinks.map(({ label: linkLabel, href }) => (
                <Link key={href} href={href} onClick={closeMenus} aria-current={isCurrentLink(pathname, href) ? "page" : undefined} className={linkClass(href, true)}>{linkLabel}</Link>
              ))}
              <a href="https://github.com/saiidz/solvelang" className={linkClass("/source", true)} target="_blank" rel="noreferrer">GitHub ↗</a>
              <div className="px-4 py-2 sm:hidden"><Suspense fallback={<span>English</span>}><LanguageSelector current={defaultLocale} /></Suspense></div>
              {signedIn ? (
                <>
                  <hr className="my-2 border-slate-200" />
                  <button type="button" onClick={() => void signOut()} disabled={busy} className="w-full rounded-xl px-4 py-3 text-left text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                    {busy ? "Signing out…" : "Sign out"}
                  </button>
                </>
              ) : null}
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}
