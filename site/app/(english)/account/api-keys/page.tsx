"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  CustomerApiError,
  type CustomerDashboard,
  type IssuedApiKey,
  customerApi,
  magicTokenFromHash,
  newRequestId,
  normalizeApiBase,
} from "@/app/account/core/customer-api";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const plans = [
  { key: "developer", name: "Developer", price: "$49/month", credits: "1,000 weighted credits", keys: "2 active keys" },
  { key: "pro", name: "Pro", price: "$199/month", credits: "10,000 weighted credits", keys: "3 active keys" },
  { key: "business", name: "Business", price: "$699/month", credits: "50,000 weighted credits", keys: "5 active keys" },
] as const;

type Screen = "loading" | "signed-out" | "dashboard";

function readableDate(value: number | string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export default function ApiKeysPage() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [dashboard, setDashboard] = useState<CustomerDashboard | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [email, setEmail] = useState("");
  const [credentialUsername, setCredentialUsername] = useState("");
  const [credentialPassword, setCredentialPassword] = useState("");
  const [keyName, setKeyName] = useState("API integration");
  const [issued, setIssued] = useState<IssuedApiKey | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refreshDashboard() {
    const account = await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
    setDashboard(account);
    setCredentialUsername(account.auth.username ?? "");
    setScreen("dashboard");
    return account;
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = magicTokenFromHash(window.location.hash);
        if (token) {
          await customerApi(API_BASE, "/customer/auth/verify", {
            method: "POST",
            body: JSON.stringify({ token }),
          });
          window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
        }
        const account = await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
        if (active) {
          setDashboard(account);
          setCredentialUsername(account.auth.username ?? "");
          setScreen("dashboard");
        }
      } catch (caught) {
        if (!active) return;
        const apiError = caught instanceof CustomerApiError ? caught : null;
        setScreen("signed-out");
        if (apiError && apiError.status !== 401) setError(apiError.message);
      }
    })();
    return () => { active = false; };
  }, []);

  async function passwordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await customerApi(API_BASE, "/customer/auth/password", {
        method: "POST",
        body: JSON.stringify({ identifier, password: loginPassword }),
      });
      setLoginPassword("");
      await refreshDashboard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function requestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await customerApi(API_BASE, "/customer/auth/magic-link", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setNotice("Check your email for a sign-in link. It expires in 15 minutes.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dashboard) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await customerApi<{ auth: CustomerDashboard["auth"] }>(
        API_BASE,
        "/customer/auth/credentials",
        {
          method: "POST",
          csrfToken: dashboard.csrfToken,
          body: JSON.stringify({
            username: credentialUsername,
            password: credentialPassword,
          }),
        },
      );
      setCredentialPassword("");
      setDashboard({ ...dashboard, auth: result.auth });
      setCredentialUsername(result.auth.username ?? credentialUsername);
      setNotice("Password sign-in is ready. Future sign-ins do not require an email.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Password sign-in could not be configured.");
    } finally {
      setBusy(false);
    }
  }

  async function issueKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dashboard) return;
    setBusy(true);
    setError("");
    setIssued(null);
    try {
      const result = await customerApi<IssuedApiKey>(API_BASE, "/customer/keys", {
        method: "POST",
        csrfToken: dashboard.csrfToken,
        body: JSON.stringify({ name: keyName }),
      });
      setIssued(result);
      await refreshDashboard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "API key could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(keyId: string) {
    if (!dashboard || !window.confirm("Revoke this API key? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      await customerApi(API_BASE, "/customer/keys/revoke", {
        method: "POST",
        csrfToken: dashboard.csrfToken,
        body: JSON.stringify({ keyId }),
      });
      setNotice("API key revoked.");
      await refreshDashboard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "API key could not be revoked.");
    } finally {
      setBusy(false);
    }
  }

  function startCheckout(plan: "developer" | "pro" | "business") {
    if (!dashboard) return;
    const query = new URLSearchParams({ plan, request_id: newRequestId() });
    window.location.assign(`/account/api-checkout/?${query.toString()}`);
  }

  async function manageSubscription() {
    if (!dashboard?.subscription.plan) return;
    setBusy(true);
    setError("");
    try {
      const result = await customerApi<{ url: string }>(API_BASE, "/customer/subscriptions/portal", {
        method: "POST",
        csrfToken: dashboard.csrfToken,
      });
      window.location.assign(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Subscription management could not be opened.");
      setBusy(false);
    }
  }

  async function signOut() {
    if (!dashboard) return;
    setBusy(true);
    try {
      await customerApi(API_BASE, "/customer/auth/logout", {
        method: "POST",
        csrfToken: dashboard.csrfToken,
      });
    } finally {
      setDashboard(null);
      setIssued(null);
      setLoginPassword("");
      setCredentialPassword("");
      setScreen("signed-out");
      setBusy(false);
    }
  }

  if (screen === "loading") {
    return <main className="grid min-h-screen place-items-center bg-slate-950 text-white">Loading your API account…</main>;
  }

  if (screen === "signed-out") {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
            <Link href="/api-pricing/" className="text-sm text-slate-300 hover:text-white">← API pricing</Link>
            <p className="mt-8 text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">SolveLang API</p>
            <h1 className="mt-3 text-4xl font-bold">Sign in</h1>
            <p className="mt-4 text-slate-300">Use your email address or username and password. Normal password sign-ins do not send email.</p>
            <form className="mt-8 space-y-4" onSubmit={passwordLogin}>
              <label className="block text-sm font-medium" htmlFor="identifier">Email or username</label>
              <input
                id="identifier"
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
                className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none focus:border-cyan-300"
                placeholder="you@company.com or username"
              />
              <label className="block text-sm font-medium" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                required
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                autoComplete="current-password"
                className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none focus:border-cyan-300"
              />
              <button disabled={busy} className="w-full rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 disabled:opacity-60">
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">First sign-in or recovery</p>
            <h2 className="mt-3 text-2xl font-bold">Use a secure email link</h2>
            <p className="mt-4 text-slate-300">
              New accounts verify their email once here. You can also use this if you forget your password, then set a new password after signing in.
            </p>
            <form className="mt-8 space-y-4" onSubmit={requestLink}>
              <label className="block text-sm font-medium" htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none focus:border-cyan-300"
                placeholder="you@company.com"
              />
              <button disabled={busy} className="w-full rounded-xl border border-cyan-300/40 px-5 py-3 font-bold text-cyan-100 disabled:opacity-60">
                {busy ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          </section>
        </div>
        <div className="mx-auto mt-6 max-w-5xl">
          {notice ? <p className="rounded-xl bg-emerald-400/10 p-4 text-sm text-emerald-200">{notice}</p> : null}
          {error ? <p className="rounded-xl bg-red-400/10 p-4 text-sm text-red-200">{error}</p> : null}
        </div>
      </main>
    );
  }

  if (!dashboard) return null;
  const activeKeys = dashboard.keys.filter((key) => !key.revokedAt);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">API account</p>
            <h1 className="mt-2 text-4xl font-bold">Keys, subscription, and credits</h1>
            <p className="mt-2 text-slate-400">{dashboard.email}</p>
          </div>
          <div className="flex gap-3">
            <Link href="/api-pricing/" className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/5">Plans</Link>
            <button onClick={signOut} disabled={busy} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/5 disabled:opacity-60">Sign out</button>
          </div>
        </header>

        {notice ? <p className="mt-6 rounded-xl bg-emerald-400/10 p-4 text-emerald-200">{notice}</p> : null}
        {error ? <p className="mt-6 rounded-xl bg-red-400/10 p-4 text-red-200">{error}</p> : null}

        <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Account security</p>
              <h2 className="mt-2 text-2xl font-bold">
                {dashboard.auth.passwordConfigured ? "Password sign-in enabled" : "Set up password sign-in"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                {dashboard.auth.passwordConfigured
                  ? `Sign in with ${dashboard.auth.username} or your email. Use this form after an email recovery link to replace your password.`
                  : "Choose a username and password once. Future sign-ins will not need an email link."}
              </p>
            </div>
            {dashboard.auth.passwordConfigured
              ? <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-sm text-emerald-200">Ready</span>
              : <span className="rounded-full bg-amber-300/10 px-3 py-1 text-sm text-amber-100">Setup needed</span>}
          </div>
          <form onSubmit={saveCredentials} className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div>
              <label htmlFor="credential-username" className="block text-sm font-medium">Username</label>
              <input
                id="credential-username"
                required
                minLength={3}
                maxLength={32}
                disabled={Boolean(dashboard.auth.username)}
                value={credentialUsername}
                onChange={(event) => setCredentialUsername(event.target.value)}
                autoComplete="username"
                className="mt-2 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none focus:border-cyan-300 disabled:opacity-60"
              />
            </div>
            <div>
              <label htmlFor="credential-password" className="block text-sm font-medium">
                {dashboard.auth.passwordConfigured ? "New password" : "Password"}
              </label>
              <input
                id="credential-password"
                type="password"
                required
                minLength={12}
                maxLength={128}
                value={credentialPassword}
                onChange={(event) => setCredentialPassword(event.target.value)}
                autoComplete="new-password"
                className="mt-2 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none focus:border-cyan-300"
              />
            </div>
            <button disabled={busy} className="rounded-xl bg-white px-5 py-3 font-bold text-slate-950 disabled:opacity-40">
              {dashboard.auth.passwordConfigured ? "Update password" : "Enable password sign-in"}
            </button>
          </form>
        </section>

        <section className="mt-8 grid gap-5 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-slate-400">Plan</p>
            <p className="mt-2 text-2xl font-bold capitalize">{dashboard.subscription.plan ?? "No subscription"}</p>
            <p className="mt-1 text-sm capitalize text-slate-300">{dashboard.subscription.status}</p>
            {dashboard.subscription.plan ? (
              <button type="button" onClick={manageSubscription} disabled={busy} className="mt-5 rounded-xl border border-cyan-300/30 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-60">
                Manage subscription
              </button>
            ) : null}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-slate-400">Credits used</p>
            <p className="mt-2 text-2xl font-bold">{dashboard.usage.used ?? 0} / {dashboard.usage.limit ?? "—"}</p>
            <p className="mt-1 text-sm text-slate-300">Remaining {dashboard.usage.remaining ?? "—"} · Period {dashboard.usage.period}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-slate-400">Active API keys</p>
            <p className="mt-2 text-2xl font-bold">{activeKeys.length}</p>
            <p className="mt-1 text-sm text-slate-300">Current period ends {readableDate(dashboard.subscription.currentPeriodEnd)}</p>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-fuchsia-300/20 bg-fuchsia-300/5 p-5 text-sm text-slate-200">
          One base credit covers up to 5,000 input tokens and 1,000 output tokens. Express, Priority, and Critical processing are not selectable yet; paid priority remains disabled until the queue-backed worker is enabled and validated.
        </section>

        {!dashboard.subscription.plan ? (
          <section className="mt-8 rounded-3xl border border-cyan-300/30 bg-cyan-300/5 p-6">
            <h2 className="text-2xl font-bold">Choose an API plan</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {plans.map((plan) => (
                <div key={plan.key} className="rounded-2xl border border-white/10 bg-slate-950/50 p-5">
                  <h3 className="text-xl font-bold">{plan.name}</h3>
                  <p className="mt-2 font-semibold text-cyan-200">{plan.price}</p>
                  <p className="mt-3 text-sm text-slate-300">{plan.credits}</p>
                  <p className="mt-1 text-sm text-slate-300">{plan.keys}</p>
                  <button disabled={busy} onClick={() => startCheckout(plan.key)} className="mt-5 w-full rounded-xl bg-cyan-300 px-4 py-2 font-bold text-slate-950 disabled:opacity-60">
                    Start checkout
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {issued ? (
          <section className="mt-8 rounded-3xl border border-amber-300/40 bg-amber-300/10 p-6">
            <h2 className="text-2xl font-bold text-amber-100">Copy this key now</h2>
            <p className="mt-2 text-sm text-amber-100/80">For security, the complete key will not be shown again.</p>
            <pre className="mt-5 overflow-x-auto rounded-xl bg-black/40 p-4 text-sm text-amber-50">{issued.env}</pre>
            <button onClick={() => navigator.clipboard.writeText(issued.env)} className="mt-4 rounded-xl bg-amber-200 px-4 py-2 font-bold text-slate-950">Copy .env values</button>
          </section>
        ) : null}

        <section className="mt-8 grid gap-8 lg:grid-cols-[360px_1fr]">
          <form onSubmit={issueKey} className="h-fit rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-bold">Create API key</h2>
            <p className="mt-2 text-sm text-slate-400">Keys receive the repository audit scope assigned by your plan.</p>
            <label htmlFor="key-name" className="mt-6 block text-sm font-medium">Key name</label>
            <input id="key-name" required maxLength={80} value={keyName} onChange={(event) => setKeyName(event.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none focus:border-cyan-300" />
            <button disabled={busy || !dashboard.subscription.plan} className="mt-5 w-full rounded-xl bg-white px-4 py-3 font-bold text-slate-950 disabled:opacity-40">Create one-time key</button>
          </form>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-bold">API keys</h2>
            <div className="mt-5 space-y-3">
              {dashboard.keys.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/15 p-6 text-slate-400">No API keys yet.</p>
              ) : dashboard.keys.map((key) => (
                <article key={key.keyId} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/15 p-5 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="font-bold">{key.name}</h3>
                    <p className="mt-1 font-mono text-sm text-slate-300">{key.prefix}…{key.lastFour}</p>
                    <p className="mt-2 text-xs text-slate-500">Created {readableDate(key.createdAt)} · Last used {readableDate(key.lastUsedAt)}</p>
                  </div>
                  {key.revokedAt
                    ? <span className="rounded-full bg-red-400/10 px-3 py-1 text-sm text-red-200">Revoked</span>
                    : <button disabled={busy} onClick={() => revokeKey(key.keyId)} className="rounded-xl border border-red-300/30 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-300/10 disabled:opacity-60">Revoke</button>}
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
