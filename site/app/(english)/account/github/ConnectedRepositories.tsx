"use client";

// Your repositories run themselves: the connected-repositories and
// auto-run section on the account GitHub page. It reads two services
// the signed-in account pages already use — the account API for what
// is connected, and the runners service for the auto-run state and
// totals, fetched with the same base and session pattern as the
// runner-minutes checkout. Everything rendered here is plain customer
// language: connected GitHub account, repository, checks, minutes.

import { useEffect, useRef, useState } from "react";
import { customerApi } from "@/app/account/core/customer-api";
import { githubInstallStartUrl } from "@/app/account/core/github-install";
import {
  type GitHubBindingsView,
  type RunnerMinutesAccountView,
  DEFAULT_RUNNER_MINUTES_ACCOUNT,
  normalizeGitHubBindings,
  normalizeRunnerMinutesAccount,
} from "@/app/account/core/github-auto-run";

type ConnectLinkResponse = { installUrl?: string };

function formatWhen(at: string): string {
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) return at;
  return new Date(parsed).toLocaleString("en-US");
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  return minutes.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function ConnectedRepositories({
  apiBase,
  runnersApiBase,
}: {
  apiBase: string;
  runnersApiBase: string;
}) {
  const [bindings, setBindings] = useState<GitHubBindingsView | null>(null);
  const [minutesAccount, setMinutesAccount] = useState<RunnerMinutesAccountView>(
    DEFAULT_RUNNER_MINUTES_ACCOUNT,
  );
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;
    (async () => {
      try {
        const raw = await customerApi<unknown>(apiBase, "/customer/github/bindings", { method: "GET" });
        if (active) setBindings(normalizeGitHubBindings(raw));
      } catch {
        // A 503 or any other failure from the bindings route means the
        // connected state is not available yet: show the not-connected
        // state, never an error dump.
        if (active) setBindings(normalizeGitHubBindings(null));
      }
      try {
        const raw = await customerApi<unknown>(runnersApiBase, "/customer/runner-minutes/account", { method: "GET" });
        if (active) setMinutesAccount(normalizeRunnerMinutesAccount(raw));
      } catch {
        // An older or unreachable runners service leaves the section
        // at its default: on, with no totals shown.
        if (active) setMinutesAccount(DEFAULT_RUNNER_MINUTES_ACCOUNT);
      }
    })();
    return () => {
      active = false;
    };
  }, [apiBase, runnersApiBase]);

  async function connectGitHub() {
    if (connectBusy) return;
    setConnectBusy(true);
    setConnectFailed(false);
    try {
      const result = await customerApi<ConnectLinkResponse>(apiBase, "/customer/github/connect-link", { method: "GET" });
      if (result.installUrl) {
        window.location.assign(result.installUrl);
        return;
      }
      setConnectFailed(true);
    } catch {
      setConnectFailed(true);
    } finally {
      setConnectBusy(false);
    }
  }

  const autoRun = minutesAccount.autoRun;

  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
      <h2 className="text-2xl font-bold">Your repositories run themselves</h2>
      <p className="mt-3 max-w-2xl leading-7 text-slate-300">
        When a repository is connected, its checks run on SolveLang runners and use your prepaid minutes. You do not need to do anything else.
      </p>

      {bindings === null ? (
        <p className="mt-4 text-slate-300">Loading your repositories…</p>
      ) : !bindings.connected ? (
        <>
          <p className="mt-4 text-slate-300">No GitHub account is connected yet.</p>
          <button
            type="button"
            disabled={connectBusy}
            onClick={() => void connectGitHub()}
            className="mt-6 inline-flex rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-200 disabled:opacity-60"
          >
            {connectBusy ? "Opening GitHub…" : "Connect GitHub"}
          </button>
          {connectFailed ? (
            <p className="mt-4 text-sm text-slate-300">
              That link could not be opened just now. You can connect with the{" "}
              <a href={githubInstallStartUrl(apiBase)} className="font-semibold text-cyan-300 underline">
                Install the SolveLang app
              </a>{" "}
              button on this page instead — it does the same job.
            </p>
          ) : null}
        </>
      ) : (
        <>
          {bindings.accounts.map((account) => (
            <p key={account.login} className="mt-4 text-slate-300">
              Connected GitHub account: <span className="font-bold text-white">{account.login}</span>
            </p>
          ))}
          {minutesAccount.status === "paused" ? (
            <p className="mt-3 text-slate-300">Paused — your checks will not run and no minutes will be used.</p>
          ) : (
            <p className="mt-3 text-slate-300">On — checks run automatically.</p>
          )}
          {bindings.repositories.length > 0 ? (
            <ul className="mt-6 space-y-3">
              {bindings.repositories.map((repository) => (
                <li key={repository.fullName} className="rounded-2xl border border-white/10 bg-black/10 p-5">
                  <p className="font-mono font-bold">{repository.fullName}</p>
                  <p className="mt-1 text-sm text-slate-300">Connected — checks run on your minutes</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-slate-300">Your GitHub account is connected. No repositories are connected yet.</p>
          )}
          {autoRun ? (
            <div className="mt-6">
              <p className="text-slate-200">
                Jobs run so far: {autoRun.jobsServed === null ? "—" : autoRun.jobsServed.toLocaleString("en-US")}
              </p>
              <p className="mt-1 text-slate-200">Minutes used: {formatMinutes(autoRun.minutesUsed)}</p>
              {autoRun.recentServes.length > 0 ? (
                <>
                  <h3 className="mt-5 font-bold">Recent jobs</h3>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    {autoRun.recentServes.slice(0, 5).map((serve) => (
                      <li key={`${serve.jobId}-${serve.at}`} className="rounded-xl border border-white/10 bg-black/10 px-4 py-3">
                        <span className="font-mono">{serve.repository}</span> — {formatMinutes(serve.minutes)}{" "}
                        minutes — {formatWhen(serve.at)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
