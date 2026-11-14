"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  type CustomerDashboard,
  customerApi,
  normalizeApiBase,
} from "@/app/account/core/customer-api";
import {
  ADMIN_ACCOUNTS_PATH,
  adminActionPath,
  formatMinuteCount,
  formatNearestExpiry,
  normalizeAdminAccounts,
  normalizeAdminActionResult,
  parseMinutesInput,
  type RunnerMinutesAdminAccount,
  type RunnerMinutesPool,
} from "@/app/account/core/runner-minutes-admin";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);

type Screen = "loading" | "signed-out" | "not-available" | "ready";
type PendingConfirm = { tenantId: string; kind: "debit" | "pause"; minutes: number | null } | null;

function actionNotice(action: string, raw: unknown, requestedMinutes: number | null): string {
  const detail =
    typeof raw === "object" && raw !== null ? (raw as { detail?: Record<string, unknown> }).detail : undefined;
  if (action === "credit") return `Added ${formatMinuteCount(requestedMinutes ?? 0)} to this account.`;
  if (action === "debit") {
    const debited = typeof detail?.debitedMinutes === "number" ? detail.debitedMinutes : requestedMinutes ?? 0;
    return debited < (requestedMinutes ?? 0)
      ? `Took ${formatMinuteCount(debited)} — that was the account's whole balance in that pool.`
      : `Took ${formatMinuteCount(debited)} from this account.`;
  }
  if (action === "pause") return "Account paused. Its jobs will not run and no minutes will be used until you resume it.";
  return "Account resumed. Its jobs can run again.";
}

export default function RunnerMinutesAdmin() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [accounts, setAccounts] = useState<RunnerMinutesAdminAccount[]>([]);
  const [csrfToken, setCsrfToken] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busyTenant, setBusyTenant] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [minutesText, setMinutesText] = useState<Record<string, string>>({});
  const [poolChoice, setPoolChoice] = useState<Record<string, RunnerMinutesPool>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      let dashboard: CustomerDashboard;
      try {
        dashboard = await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
      } catch {
        if (active) setScreen("signed-out");
        return;
      }
      if (!active) return;
      setCsrfToken(dashboard.csrfToken);
      try {
        const raw = await customerApi<unknown>(API_BASE, ADMIN_ACCOUNTS_PATH, { method: "GET" });
        if (!active) return;
        const view = normalizeAdminAccounts(raw);
        if (!view.configured) {
          setScreen("not-available");
          return;
        }
        setAccounts(view.accounts);
        setScreen("ready");
      } catch {
        if (active) setScreen("not-available");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function runAction(
    account: RunnerMinutesAdminAccount,
    action: "credit" | "debit" | "pause" | "resume",
    confirmedMinutes?: number,
  ) {
    const pool = poolChoice[account.tenantId] ?? "standard";
    const minutes =
      action === "credit" || action === "debit"
        ? confirmedMinutes ?? parseMinutesInput(minutesText[account.tenantId] ?? "")
        : null;
    if ((action === "credit" || action === "debit") && minutes === null) {
      setError("Type a whole number of minutes above zero first.");
      return;
    }
    setBusyTenant(account.tenantId);
    setError("");
    setNotice("");
    try {
      const raw = await customerApi<unknown>(API_BASE, adminActionPath(account.tenantId, action), {
        method: "POST",
        csrfToken,
        body: JSON.stringify(action === "credit" || action === "debit" ? { pool, minutes } : {}),
      });
      const fresh = normalizeAdminActionResult(raw);
      if (fresh) {
        setAccounts((rows) => rows.map((row) => (row.tenantId === fresh.tenantId ? fresh : row)));
      }
      setNotice(actionNotice(action, raw, minutes));
      setConfirm(null);
    } catch {
      setError("That action did not go through. Check the account and try again.");
    } finally {
      setBusyTenant(null);
    }
  }

  if (screen === "loading") {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-slate-300">Loading runner minutes…</p>
        </div>
      </main>
    );
  }

  if (screen === "signed-out") {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 py-16 text-white">
        <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">SolveLang owner</p>
          <h1 className="mt-3 text-3xl font-bold">Runner minutes admin</h1>
          <p className="mt-4 text-slate-300">Sign in to your SolveLang account first. This page needs your session before it can show anything.</p>
          <Link href="/account/api-keys/" className="mt-8 inline-flex rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-200">Go to sign in</Link>
        </section>
      </main>
    );
  }

  if (screen === "not-available") {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 py-16 text-white">
        <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">SolveLang owner</p>
          <h1 className="mt-3 text-3xl font-bold">Runner minutes admin</h1>
          <p className="mt-4 text-slate-300">This page is not available for your account.</p>
          <Link href="/account/" className="mt-8 inline-flex rounded-xl bg-white/10 px-5 py-3 font-bold text-white hover:bg-white/20">Back to your account</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-4xl">
        <header className="border-b border-white/10 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">SolveLang owner</p>
          <h1 className="mt-2 text-4xl font-bold">Runner minutes admin</h1>
          <p className="mt-3 max-w-2xl leading-7 text-slate-300">
            Every runner-minutes account, its balance and its status. You can add minutes, take minutes back,
            and pause or resume an account. Pausing stops the account being served: its jobs will not run and
            no minutes will be used until you resume it. Every action is written into the ledger.
          </p>
        </header>

        {notice ? <p className="mt-6 rounded-xl bg-emerald-400/10 p-4 text-sm text-emerald-200">{notice}</p> : null}
        {error ? <p className="mt-6 rounded-xl bg-red-400/10 p-4 text-sm text-red-200">{error}</p> : null}

        {accounts.length === 0 ? (
          <p className="mt-8 text-slate-300">No runner-minutes accounts yet. An account appears here after its first purchase or credit.</p>
        ) : (
          <ul className="mt-8 space-y-6">
            {accounts.map((account) => {
              const busy = busyTenant === account.tenantId;
              const pool = poolChoice[account.tenantId] ?? "standard";
              const minutes = parseMinutesInput(minutesText[account.tenantId] ?? "");
              const confirming = confirm?.tenantId === account.tenantId ? confirm : null;
              return (
                <li key={account.tenantId} className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-bold">Minutes account</h2>
                    {account.status === "paused" ? (
                      <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">Paused</span>
                    ) : (
                      <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">Active</span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-slate-400">Account ID: {account.tenantId}</p>

                  <dl className="mt-6 grid gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                      <dt className="text-sm text-slate-400">Standard minutes</dt>
                      <dd className="mt-1 text-xl font-bold">{formatMinuteCount(account.standardMinutes)}</dd>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                      <dt className="text-sm text-slate-400">High-power minutes</dt>
                      <dd className="mt-1 text-xl font-bold">{formatMinuteCount(account.highPowerMinutes)}</dd>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                      <dt className="text-sm text-slate-400">Speed lane cache</dt>
                      <dd className="mt-1 text-xl font-bold">{account.cacheGbMonths} GB-months</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-sm text-slate-400">{formatNearestExpiry(account.nearestLotExpiresAt)}</p>

                  <div className="mt-6 flex flex-wrap items-end gap-3">
                    <label className="block">
                      <span className="text-sm text-slate-300">Pool</span>
                      <select
                        value={pool}
                        onChange={(event) =>
                          setPoolChoice((choices) => ({ ...choices, [account.tenantId]: event.target.value as RunnerMinutesPool }))
                        }
                        className="mt-1 block rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-white"
                      >
                        <option value="standard">Standard</option>
                        <option value="high-power">High-power</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm text-slate-300">Minutes</span>
                      <input
                        value={minutesText[account.tenantId] ?? ""}
                        onChange={(event) =>
                          setMinutesText((texts) => ({ ...texts, [account.tenantId]: event.target.value }))
                        }
                        inputMode="numeric"
                        placeholder="e.g. 250"
                        className="mt-1 block w-36 rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-white"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runAction(account, "credit")}
                      className="rounded-xl bg-cyan-300 px-4 py-2 font-bold text-slate-950 hover:bg-cyan-200 disabled:opacity-50"
                    >
                      Add minutes
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (minutes === null) {
                          setError("Type a whole number of minutes above zero first.");
                          return;
                        }
                        setConfirm({ tenantId: account.tenantId, kind: "debit", minutes });
                      }}
                      className="rounded-xl bg-white/10 px-4 py-2 font-bold text-white hover:bg-white/20 disabled:opacity-50"
                    >
                      Take minutes
                    </button>
                    {account.status === "paused" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => runAction(account, "resume")}
                        className="rounded-xl bg-emerald-300 px-4 py-2 font-bold text-slate-950 hover:bg-emerald-200 disabled:opacity-50"
                      >
                        Resume account
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirm({ tenantId: account.tenantId, kind: "pause", minutes: null })}
                        className="rounded-xl bg-amber-300 px-4 py-2 font-bold text-slate-950 hover:bg-amber-200 disabled:opacity-50"
                      >
                        Pause account
                      </button>
                    )}
                  </div>

                  {confirming ? (
                    <div className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4">
                      <p className="text-sm text-amber-100">
                        {confirming.kind === "debit"
                          ? `Take ${formatMinuteCount(confirming.minutes ?? 0)} from this account's ${pool === "high-power" ? "High-power" : "Standard"} pool? This cannot be undone.`
                          : "Pause this account? Its jobs will not run and no minutes will be used until you resume it."}
                      </p>
                      <div className="mt-3 flex gap-3">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            runAction(
                              account,
                              confirming.kind === "debit" ? "debit" : "pause",
                              confirming.kind === "debit" ? (confirming.minutes ?? undefined) : undefined,
                            )
                          }
                          className="rounded-xl bg-amber-300 px-4 py-2 font-bold text-slate-950 hover:bg-amber-200 disabled:opacity-50"
                        >
                          {confirming.kind === "debit" ? "Yes, take them" : "Yes, pause it"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirm(null)}
                          className="rounded-xl bg-white/10 px-4 py-2 font-bold text-white hover:bg-white/20 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
