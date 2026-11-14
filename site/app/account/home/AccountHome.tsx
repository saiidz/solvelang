"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CustomerApiError,
  type CustomerDashboard,
  customerApi,
  normalizeApiBase,
} from "@/app/account/core/customer-api";

// The account home: one page that points at everything in the
// account — the API account (keys, plan, credits), the Live Center,
// and Runner Minutes. The session is gated against the account API
// like every account page; the minutes balance is read from the
// Runner Minutes service at its own base URL, the same read the
// checkout page makes. The service's production home is
// https://runners.solve-lang.com — the page points there by default;
// NEXT_PUBLIC_RUNNER_MINUTES_BASE_URL overrides the base when set.
const ACCOUNT_API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const RUNNERS_API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_RUNNER_MINUTES_BASE_URL || "https://runners.solve-lang.com");

type RunnerMinutesAccountView = {
  balances: {
    standard: { minutes: number };
    highPower: { minutes: number };
    cache: { gbMonths: number };
  };
};

type Screen = "loading" | "signed-out" | "home";
type BalanceState = "loading" | "ready" | "unavailable";

const cardClass = "rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl";
const cardEyebrowClass = "text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300";
const cardLinkClass = "mt-8 inline-block rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/5";

export function AccountHome() {
  const startedRef = useRef(false);
  const [screen, setScreen] = useState<Screen>("loading");
  const [dashboard, setDashboard] = useState<CustomerDashboard | null>(null);
  const [error, setError] = useState("");
  const [balanceState, setBalanceState] = useState<BalanceState>("loading");
  const [minutes, setMinutes] = useState<RunnerMinutesAccountView["balances"] | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;

    async function prepare() {
      try {
        // Session gate first, exactly like the other account pages:
        // this call fails with 401 unless the visitor is signed in.
        const account = await customerApi<CustomerDashboard>(ACCOUNT_API_BASE, "/customer/account", { method: "GET" });
        if (!active) return;
        setDashboard(account);
        setScreen("home");
      } catch (caught) {
        if (!active) return;
        setScreen("signed-out");
        const apiError = caught instanceof CustomerApiError ? caught : null;
        if (apiError && apiError.status !== 401) setError(apiError.message);
        return;
      }
      try {
        const view = await customerApi<RunnerMinutesAccountView>(RUNNERS_API_BASE, "/customer/runner-minutes/account", { method: "GET" });
        if (!active) return;
        setMinutes(view.balances);
        setBalanceState("ready");
      } catch {
        // The balance is never guessed: if the service cannot be
        // reached, the card says so and points at the checkout page,
        // which shows the balance before any purchase.
        if (!active) return;
        setBalanceState("unavailable");
      }
    }

    void prepare();
    return () => {
      active = false;
    };
  }, []);

  if (screen === "loading") {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-6xl">
          <p className="text-slate-300">Loading your account…</p>
        </div>
      </main>
    );
  }

  if (screen === "signed-out") {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
          <section className={cardClass}>
            <p className={cardEyebrowClass}>SolveLang API</p>
            <h1 className="mt-3 text-4xl font-bold">Sign in</h1>
            <p className="mt-4 text-slate-300">Use your email address or username and password. Normal password sign-ins do not send email.</p>
            <Link href="/account/api-keys/" className="mt-8 flex w-full items-center justify-center rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-200">
              Sign in
            </Link>
          </section>

          <section className={cardClass}>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">First sign-in or recovery</p>
            <h2 className="mt-3 text-2xl font-bold">Use a secure email link</h2>
            <p className="mt-4 text-slate-300">New accounts verify their email once here. If authenticator 2FA is enabled, recovery still requires the authenticator or a backup code.</p>
            <Link href="/account/api-keys/" className="mt-8 flex w-full items-center justify-center rounded-xl border border-cyan-300/40 px-5 py-3 font-bold text-cyan-100 hover:bg-white/5">
              Email me a sign-in link
            </Link>
          </section>
        </div>
        {error ? (
          <div className="mx-auto mt-6 max-w-5xl">
            <p className="rounded-xl bg-red-400/10 p-4 text-sm text-red-200">{error}</p>
          </div>
        ) : null}
      </main>
    );
  }

  const totalMinutes = minutes ? minutes.standard.minutes + minutes.highPower.minutes : 0;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-6xl">
        <header className="border-b border-white/10 pb-8">
          <p className={cardEyebrowClass}>Your account</p>
          <h1 className="mt-2 text-4xl font-bold">Everything in one place</h1>
          <p className="mt-2 text-slate-400">{dashboard?.email ?? "Your SolveLang account"}</p>
        </header>

        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <section className={cardClass}>
            <p className={cardEyebrowClass}>SolveLang API</p>
            <h2 className="mt-3 text-2xl font-bold">API account</h2>
            <p className="mt-4 text-slate-300">Your API keys, the plan you are on, and the credits your plan includes.</p>
            <Link href="/account/api-keys/" className={cardLinkClass}>
              Open your API account
            </Link>
          </section>

          <section className={cardClass}>
            <p className={cardEyebrowClass}>Process Solution</p>
            <h2 className="mt-3 text-2xl font-bold">Live Center</h2>
            <p className="mt-4 text-slate-300">Your merge queue, pull request checks, and runners — the board refreshes itself every minute.</p>
            <Link href="/account/live-center/" className={cardLinkClass}>
              Open Live Center
            </Link>
          </section>

          <section className={cardClass}>
            <p className={cardEyebrowClass}>Runner Minutes</p>
            <h2 className="mt-3 text-2xl font-bold">Runner minutes</h2>
            {balanceState === "ready" && minutes ? (
              <>
                <p className="mt-4 text-4xl font-bold">{totalMinutes.toLocaleString("en-US")} minutes left</p>
                <p className="mt-2 text-sm text-slate-400">
                  Standard: {minutes.standard.minutes.toLocaleString("en-US")} minutes · High-power: {minutes.highPower.minutes.toLocaleString("en-US")} minutes
                </p>
                {minutes.cache.gbMonths > 0 ? (
                  <p className="mt-1 text-sm text-slate-400">Speed lane cache: {minutes.cache.gbMonths} GB-months</p>
                ) : null}
              </>
            ) : balanceState === "unavailable" ? (
              <p className="mt-4 text-slate-300">
                We could not load your balance just now — nothing is wrong with your minutes. The checkout page shows your balance before you buy.
              </p>
            ) : (
              <p className="mt-4 text-slate-300">Loading your balance…</p>
            )}
            <Link href="/account/runner-minutes-checkout/" className={cardLinkClass}>
              Buy a minutes pack
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
