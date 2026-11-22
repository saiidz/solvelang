"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CustomerApiError,
  type CustomerDashboard,
  customerApi,
  normalizeApiBase,
} from "@/app/account/core/customer-api";
import {
  RUNNER_MINUTES_APPROVE_LINE,
  RUNNER_MINUTES_DECLINE_LINE,
  RUNNER_MINUTES_PAUSED_LINE,
  RUNNER_MINUTES_START_MODE_PATH,
  runnerMinutesApprovalPath,
  runnerMinutesPendingApprovals,
  runnerMinutesPoolLabel,
  runnerMinutesQueuedLabel,
  runnerMinutesStartMode,
  runnerMinutesStartModeLabel,
  runnerMinutesStatus,
  runnerMinutesToggleLabel,
  runnerMinutesTogglePath,
  type RunnerMinutesPendingApproval,
  type RunnerMinutesStartMode,
  type RunnerMinutesStatus,
} from "@/app/account/core/runner-minutes-account";

// The account home: one page that points at everything in the
// account — the API account (keys, plan, credits), the Live Center,
// and Runner Minutes — whose card also carries the start/pause
// control the checkout page has, through the shared helpers in
// app/account/core/runner-minutes-account. The session is gated
// against the account API like every account page; the minutes
// balance is read from the
// Runner Minutes service at its own base URL, the same read the
// checkout page makes. The service's production home is
// https://runners.solve-lang.com — the page points there by default;
// NEXT_PUBLIC_RUNNER_MINUTES_BASE_URL overrides the base when set.
const ACCOUNT_API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const RUNNERS_API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_RUNNER_MINUTES_BASE_URL || "https://runners.solve-lang.com");

type RunnerMinutesAccountView = {
  status?: RunnerMinutesStatus;
  startMode?: RunnerMinutesStartMode;
  pendingApprovals?: RunnerMinutesPendingApproval[];
  balances: {
    standard: { minutes: number };
    highPower: { minutes: number };
    premium?: { minutes: number };
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
  const [minutesStatus, setMinutesStatus] = useState<RunnerMinutesStatus>("active");
  const [minutesStartMode, setMinutesStartMode] = useState<RunnerMinutesStartMode>("auto");
  const [pendingApprovals, setPendingApprovals] = useState<RunnerMinutesPendingApproval[]>([]);
  const [decidingApprovalId, setDecidingApprovalId] = useState<string | null>(null);
  const [minutesBusy, setMinutesBusy] = useState(false);
  const [minutesError, setMinutesError] = useState("");

  function applyMinutesView(view: RunnerMinutesAccountView) {
    setMinutes(view.balances);
    setMinutesStatus(runnerMinutesStatus(view));
    setMinutesStartMode(runnerMinutesStartMode(view));
    setPendingApprovals(runnerMinutesPendingApprovals(view));
  }

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
        const apiError = caught instanceof CustomerApiError ? caught : null;
        if (apiError?.status === 401) {
          // Proven signed out: the door is the real sign-in page,
          // not a bare gate with two links — send the visitor
          // straight there. Any other failure (the API unreachable,
          // say) keeps the gate below with its error showing.
          window.location.replace("/account/api-keys/");
          return;
        }
        setScreen("signed-out");
        if (apiError) setError(apiError.message);
        return;
      }
      try {
        const view = await customerApi<RunnerMinutesAccountView>(RUNNERS_API_BASE, "/customer/runner-minutes/account", { method: "GET" });
        if (!active) return;
        applyMinutesView(view);
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

  async function rereadMinutes() {
    const view = await customerApi<RunnerMinutesAccountView>(RUNNERS_API_BASE, "/customer/runner-minutes/account", { method: "GET" });
    applyMinutesView(view);
  }

  async function chooseStartMode(mode: RunnerMinutesStartMode) {
    if (!dashboard || minutesBusy || mode === minutesStartMode) return;
    setMinutesBusy(true);
    setMinutesError("");
    try {
      await customerApi<Record<string, never>>(
        RUNNERS_API_BASE,
        RUNNER_MINUTES_START_MODE_PATH,
        { method: "POST", csrfToken: dashboard.csrfToken, body: JSON.stringify({ startMode: mode }) },
      );
      // Re-read the account and render the state the service
      // reports — never a blind local flip.
      await rereadMinutes();
    } catch (caught) {
      setMinutesError(caught instanceof Error ? caught.message : "Your start mode could not be changed.");
    } finally {
      setMinutesBusy(false);
    }
  }

  async function decideApproval(approvalId: string, decision: "approve" | "decline") {
    if (!dashboard || decidingApprovalId) return;
    setDecidingApprovalId(approvalId);
    setMinutesError("");
    try {
      await customerApi<Record<string, never>>(
        RUNNERS_API_BASE,
        runnerMinutesApprovalPath(approvalId, decision),
        { method: "POST", csrfToken: dashboard.csrfToken, body: JSON.stringify({}) },
      );
      await rereadMinutes();
    } catch (caught) {
      setMinutesError(caught instanceof Error ? caught.message : "Your decision could not be recorded.");
    } finally {
      setDecidingApprovalId(null);
    }
  }

  async function toggleMinutes() {
    if (!dashboard || minutesBusy) return;
    setMinutesBusy(true);
    setMinutesError("");
    try {
      await customerApi<Record<string, never>>(
        RUNNERS_API_BASE,
        runnerMinutesTogglePath(minutesStatus),
        { method: "POST", csrfToken: dashboard.csrfToken },
      );
      // Re-read the account and render the state the service reports —
      // never a blind local flip.
      await rereadMinutes();
    } catch (caught) {
      setMinutesError(caught instanceof Error ? caught.message : "Your minutes setting could not be changed.");
    } finally {
      setMinutesBusy(false);
    }
  }

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

  const totalMinutes = minutes ? minutes.standard.minutes + minutes.highPower.minutes + (minutes.premium?.minutes ?? 0) : 0;

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
                {minutes.premium && minutes.premium.minutes > 0 ? (
                  <p className="mt-1 text-sm text-slate-400">Premium: {minutes.premium.minutes.toLocaleString("en-US")} minutes</p>
                ) : null}
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
            {balanceState === "ready" && minutes ? (
              <div className="mt-6 border-t border-white/10 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold">Runner minutes: {minutesStatus === "paused" ? "Paused" : "Active"}</p>
                  <button
                    type="button"
                    disabled={minutesBusy}
                    onClick={() => void toggleMinutes()}
                    className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/5 disabled:opacity-60"
                  >
                    {runnerMinutesToggleLabel(minutesStatus)}
                  </button>
                </div>
                {minutesStatus === "paused" ? (
                  <p className="mt-2 text-sm text-slate-400">{RUNNER_MINUTES_PAUSED_LINE}</p>
                ) : null}
                {minutesError ? (
                  <p role="alert" className="mt-3 rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{minutesError}</p>
                ) : null}
                <div className="mt-5 border-t border-white/10 pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Start mode: {runnerMinutesStartModeLabel(minutesStartMode)}</p>
                    <div className="flex gap-2">
                      {(["auto", "approve"] as RunnerMinutesStartMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          disabled={minutesBusy || mode === minutesStartMode}
                          onClick={() => void chooseStartMode(mode)}
                          className={
                            mode === minutesStartMode
                              ? "rounded-xl bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
                              : "rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/5 disabled:opacity-60"
                          }
                        >
                          {runnerMinutesStartModeLabel(mode)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {minutesStartMode === "approve" ? (
                    <p className="mt-2 text-sm text-slate-400">{RUNNER_MINUTES_APPROVE_LINE}</p>
                  ) : null}
                </div>
                {minutesStartMode === "approve" && pendingApprovals.length > 0 ? (
                  <div className="mt-5 border-t border-white/10 pt-5">
                    <p className="text-sm font-semibold">Waiting for your approval ({pendingApprovals.length})</p>
                    <p className="mt-2 text-sm text-slate-400">{RUNNER_MINUTES_DECLINE_LINE}</p>
                    <ul className="mt-3 space-y-3">
                      {pendingApprovals.map((approval) => (
                        <li key={approval.id} className="rounded-xl border border-white/10 p-3">
                          <p className="text-sm font-semibold">{approval.repo}</p>
                          <p className="mt-1 text-sm text-slate-300">
                            {approval.workflowName ?? "Workflow"} · {approval.jobName ?? "job"} · {runnerMinutesPoolLabel(approval.pool)} pool
                          </p>
                          <p className="mt-1 text-sm text-slate-400">Queued {runnerMinutesQueuedLabel(approval.queuedAt)}</p>
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              disabled={decidingApprovalId !== null}
                              onClick={() => void decideApproval(approval.id, "approve")}
                              className="rounded-xl bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-60"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={decidingApprovalId !== null}
                              onClick={() => void decideApproval(approval.id, "decline")}
                              className="rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/5 disabled:opacity-60"
                            >
                              Decline
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-6 border-t border-white/10 pt-5">
              <p className="text-sm font-semibold">Choose the pool per pull request</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Label a pull request <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-white">solvelang-runners-premium</code> and
                its jobs run on the Premium pool, drawing from your Premium minutes. Label it{" "}
                <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-white">solvelang-runners-high-power</code> and
                its jobs run on the High-Power pool, drawing from your High-Power minutes. Label it{" "}
                <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-white">solvelang-runners-standard</code> and its jobs stay on the
                Standard pool, drawing from your Standard minutes.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                The label applies per pull request. Jobs already running are not moved, and the pool a job runs on is the balance its minutes are
                billed to. A job whose workflow file already asks for High-Power stays on High-Power.
              </p>
            </div>
            <Link href="/account/runner-minutes-checkout/" className={cardLinkClass}>
              Buy a minutes pack
            </Link>
          </section>

          <section className={cardClass}>
            <p className={cardEyebrowClass}>Agent access</p>
            <h2 className="mt-3 text-2xl font-bold">Agents acting for you</h2>
            <p className="mt-4 text-slate-300">Delegated tokens for your AI agents, the purchases they prepare for your approval, top-up mandates with hard caps, and the full activity log.</p>
            <Link href="/account/agent-access/" className={cardLinkClass}>
              Manage agent access
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
