"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { customerApi, normalizeApiBase } from "@/app/account/core/customer-api";
import {
  RUNNER_MINUTES_AUTO_RELOAD_BODY,
  RUNNER_MINUTES_AUTO_RELOAD_CARD_REQUIRED_LINE,
  RUNNER_MINUTES_AUTO_RELOAD_NO_CARD_LINE,
  RUNNER_MINUTES_AUTO_RELOAD_PATH,
  RUNNER_MINUTES_AUTO_RELOAD_TITLE,
  RUNNER_MINUTES_SAVE_CARD_PATH,
  runnerMinutesAutoReloadLastLine,
  runnerMinutesAutoReloadMinutesLabel,
  runnerMinutesAutoReloadNeedsPaymentMethod,
  runnerMinutesAutoReloadPackLabel,
  runnerMinutesAutoReloadPoolLabel,
  runnerMinutesAutoReloadPools,
  runnerMinutesSavedCardLabel,
  runnerMinutesSavedPaymentMethod,
  type RunnerMinutesAutoReloadPoolSettings,
  type RunnerMinutesAutoReloadView,
  type RunnerMinutesSavedPaymentMethod,
} from "@/app/account/core/runner-minutes-auto-reload";

// The Auto-reload card on the account home, beside the Runner
// minutes card that carries the start/pause control. It reads and
// sets the per-pool auto-reload settings the runners service owns
// (GET/POST /customer/runner-minutes/auto-reload) through the shared
// helpers in app/account/core/runner-minutes-auto-reload.
//
// The card is additive: a runners service without the auto-reload
// route (or an unreachable one) simply shows no card, exactly like
// the trial claim card. Enabling with no saved payment method is
// refused by the service with payment_method_required; the card
// then routes the customer into the existing Agent Access save-card
// flow — it never collects a card itself.
const RUNNERS_API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_RUNNER_MINUTES_BASE_URL || "https://runners.solve-lang.com");

const cardClass = "rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl";
const cardEyebrowClass = "text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300";
const cardLinkClass = "mt-8 inline-block rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/5";

type LoadState = "loading" | "ready" | "unavailable";

export function AutoReloadCard({ csrfToken }: { csrfToken: string }) {
  const startedRef = useRef(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [pools, setPools] = useState<RunnerMinutesAutoReloadPoolSettings[]>([]);
  const [savedMethod, setSavedMethod] = useState<RunnerMinutesSavedPaymentMethod | null>(null);
  const [busyPool, setBusyPool] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [cardRequired, setCardRequired] = useState(false);

  function applyView(view: RunnerMinutesAutoReloadView) {
    setPools(runnerMinutesAutoReloadPools(view));
    setSavedMethod(runnerMinutesSavedPaymentMethod(view));
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;

    async function prepare() {
      try {
        const view = await customerApi<RunnerMinutesAutoReloadView>(RUNNERS_API_BASE, RUNNER_MINUTES_AUTO_RELOAD_PATH, { method: "GET" });
        if (!active) return;
        applyView(view);
        setLoadState("ready");
      } catch {
        if (!active) return;
        setLoadState("unavailable");
      }
    }

    void prepare();
    return () => {
      active = false;
    };
  }, []);

  async function reread() {
    const view = await customerApi<RunnerMinutesAutoReloadView>(RUNNERS_API_BASE, RUNNER_MINUTES_AUTO_RELOAD_PATH, { method: "GET" });
    applyView(view);
  }

  async function savePool(settings: RunnerMinutesAutoReloadPoolSettings, enabled: boolean, packKey: string | null) {
    if (busyPool) return;
    setBusyPool(settings.pool);
    setError("");
    setCardRequired(false);
    try {
      await customerApi<Record<string, never>>(RUNNERS_API_BASE, RUNNER_MINUTES_AUTO_RELOAD_PATH, {
        method: "POST",
        csrfToken,
        body: JSON.stringify({ pool: settings.pool, enabled, packKey }),
      });
      // Re-read the settings and render the state the service
      // reports — never a blind local flip.
      await reread();
    } catch (caught) {
      if (runnerMinutesAutoReloadNeedsPaymentMethod(caught)) {
        // The service refused for want of a saved card: route the
        // customer into the existing Agent Access save-card flow.
        setCardRequired(true);
      } else {
        setError(caught instanceof Error ? caught.message : "Your auto-reload setting could not be changed.");
      }
    } finally {
      setBusyPool(null);
    }
  }

  if (loadState !== "ready") return null;

  return (
    <section className={cardClass}>
      <p className={cardEyebrowClass}>Runner Minutes</p>
      <h2 className="mt-3 text-2xl font-bold">{RUNNER_MINUTES_AUTO_RELOAD_TITLE}</h2>
      <p className="mt-4 text-slate-300">{RUNNER_MINUTES_AUTO_RELOAD_BODY}</p>

      {savedMethod ? (
        <p className="mt-4 text-sm text-slate-400">
          Saved card: {runnerMinutesSavedCardLabel(savedMethod)} — reloads charge this card.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-slate-400">{RUNNER_MINUTES_AUTO_RELOAD_NO_CARD_LINE}</p>
          <Link href={RUNNER_MINUTES_SAVE_CARD_PATH} className={cardLinkClass}>
            Save a card in Agent Access
          </Link>
        </>
      )}

      <div className="mt-6 space-y-5">
        {pools.map((settings) => {
          const lastLine = runnerMinutesAutoReloadLastLine(settings);
          const balanceLabel = runnerMinutesAutoReloadMinutesLabel(settings.balanceSeconds);
          const baselineLabel = runnerMinutesAutoReloadMinutesLabel(settings.baselineSeconds);
          return (
            <div key={settings.pool} className="border-t border-white/10 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold">{runnerMinutesAutoReloadPoolLabel(settings.pool)}: {settings.enabled ? "On" : "Off"}</p>
                <button
                  type="button"
                  aria-pressed={settings.enabled}
                  disabled={busyPool !== null}
                  onClick={() => void savePool(settings, !settings.enabled, settings.packKey)}
                  className={
                    settings.enabled
                      ? "rounded-xl bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
                      : "rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/5 disabled:opacity-60"
                  }
                >
                  {settings.enabled ? "On" : "Off"}
                </button>
              </div>
              {settings.packs.length > 0 ? (
                <label className="mt-3 block text-sm text-slate-400">
                  Reload pack
                  <select
                    value={settings.packKey ?? settings.packs[0].key}
                    disabled={busyPool !== null}
                    onChange={(event) => void savePool(settings, settings.enabled, event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-60"
                  >
                    {settings.packs.map((pack) => (
                      <option key={pack.key} value={pack.key}>
                        {runnerMinutesAutoReloadPackLabel(pack)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {balanceLabel || baselineLabel ? (
                <p className="mt-3 text-sm text-slate-400">
                  {balanceLabel ? <>Balance: {balanceLabel}</> : null}
                  {balanceLabel && baselineLabel ? " · " : null}
                  {baselineLabel ? <>Baseline: {baselineLabel}</> : null}
                </p>
              ) : null}
              {lastLine ? (
                settings.lastStatus === "failed" ? (
                  <p role="alert" className="mt-3 rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{lastLine}</p>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">{lastLine}</p>
                )
              ) : null}
            </div>
          );
        })}
      </div>

      {cardRequired ? (
        <div className="mt-5 rounded-xl bg-amber-400/10 p-4">
          <p className="text-sm text-amber-200">{RUNNER_MINUTES_AUTO_RELOAD_CARD_REQUIRED_LINE}</p>
          <Link href={RUNNER_MINUTES_SAVE_CARD_PATH} className="mt-3 inline-block rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200">
            Save a card in Agent Access
          </Link>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{error}</p>
      ) : null}
    </section>
  );
}
