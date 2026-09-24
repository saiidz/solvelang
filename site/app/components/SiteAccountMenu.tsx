"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CustomerApiError,
  type CustomerDashboard,
  customerApi,
  customerSessionChangedEvent,
  normalizeApiBase,
} from "../account/core/customer-api";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);

export function SiteAccountMenu() {
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

  const label = account?.email || account?.auth.username || "your account";
  const initial = label.trim().charAt(0).toLocaleUpperCase() || "A";

  if (sessionState === "loading") {
    return <span aria-label="Checking account status" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-sm font-bold text-slate-600">…</span>;
  }

  if (sessionState === "signed-out" || !account) {
    return (
      <Link href="/account/api-keys/" aria-label={sessionState === "signed-out" ? "Sign in to your account" : "Account status unavailable; open account"} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
        <AccountIcon />
        <span className="hidden min-[340px]:inline">{sessionState === "signed-out" ? "Sign in" : "Account"}</span>
      </Link>
    );
  }

  return (
    <details className="group relative" data-site-menu="true">
      <summary aria-label={`Account menu for ${label}`} className="flex min-h-10 max-w-56 cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800">{initial}</span>
        <span className="hidden max-w-36 truncate sm:inline">{label}</span>
        <span aria-hidden="true" className="text-xs">▾</span>
      </summary>
      <div className="absolute right-0 top-full mt-3 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-3 text-slate-950 shadow-xl">
        <div className="border-b border-slate-200 px-3 pb-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Signed in as</p>
          <p className="mt-1 break-all text-sm font-semibold">{label}</p>
        </div>
        {error ? <p role="alert" className="px-3 pt-3 text-sm text-red-700">{error}</p> : null}
        <Link href="/account/api-keys/" className="mt-2 block rounded-xl px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">Manage account</Link>
        <button type="button" onClick={() => void signOut()} disabled={busy} className="w-full rounded-xl px-3 py-3 text-left text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </details>
  );
}

function AccountIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.2 20c.7-3.6 3.2-5.4 6.8-5.4s6.1 1.8 6.8 5.4" strokeLinecap="round" />
    </svg>
  );
}
