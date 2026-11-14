"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  type CustomerDashboard,
  customerApi,
  normalizeApiBase,
} from "@/app/account/core/customer-api";
import { githubInstallStartUrl, parseGitHubSetupParams } from "@/app/account/core/github-install";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);

type GitHubInstallation = {
  installationId: number;
  accountLogin: string;
  accountType: string;
  repositories: { id: number; fullName: string }[];
  suspended: boolean;
};

type InstallationsResponse = { enabled: boolean; installations: GitHubInstallation[] };
type Screen = "loading" | "signed-out" | "ready";

export default function GitHubAccountPage() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [installations, setInstallations] = useState<GitHubInstallation[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const linkAttempted = useRef(false);

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
      setScreen("ready");

      // Landing back from GitHub's install screen: link the installation
      // the signed-in account just created. The state is single-use and
      // bound to this account server-side; the URL is cleaned either way
      // so a refresh never replays it.
      const setup = parseGitHubSetupParams(window.location.search);
      if (setup && !linkAttempted.current) {
        linkAttempted.current = true;
        setBusy(true);
        try {
          await customerApi(API_BASE, "/customer/github/installations/link", {
            method: "POST",
            csrfToken: dashboard.csrfToken,
            body: JSON.stringify({ installationId: setup.installationId, state: setup.state }),
          });
          if (active) setNotice("GitHub installation linked to your SolveLang account.");
        } catch {
          if (active) setError("We couldn't link that GitHub installation. Start the install again from this page.");
        }
        if (active) setBusy(false);
        window.history.replaceState({}, "", window.location.pathname);
      }

      try {
        const result = await customerApi<InstallationsResponse>(API_BASE, "/customer/github/installations", { method: "GET" });
        if (active) {
          setEnabled(result.enabled);
          setInstallations(result.installations);
        }
      } catch {
        if (active) setError("We couldn't load your linked GitHub installations.");
      }
    })();
    return () => { active = false; };
  }, []);

  if (screen === "loading") {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-slate-300">Loading your GitHub connection…</p>
        </div>
      </main>
    );
  }

  if (screen === "signed-out") {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 py-16 text-white">
        <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">SolveLang API</p>
          <h1 className="mt-3 text-3xl font-bold">Connect GitHub</h1>
          <p className="mt-4 text-slate-300">Sign in to your SolveLang account first. The GitHub install is linked to the account you are signed in with, so this page needs your session before it can show or link installations.</p>
          <Link href="/account/api-keys/" className="mt-8 inline-flex rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-200">Go to sign in</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-4xl">
        <header className="border-b border-white/10 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">API account</p>
          <h1 className="mt-2 text-4xl font-bold">GitHub app</h1>
          <p className="mt-3 max-w-2xl leading-7 text-slate-300">
            Install the SolveLang GitHub App on your account or organization and choose exactly which
            repositories it can see. Audits read those repositories <strong>read-only</strong> — SolveLang
            cannot change your code — and you can remove a repository or uninstall the app at any time
            in your GitHub settings.
          </p>
        </header>

        {notice ? <p className="mt-6 rounded-xl bg-emerald-400/10 p-4 text-sm text-emerald-200">{notice}</p> : null}
        {error ? <p className="mt-6 rounded-xl bg-red-400/10 p-4 text-sm text-red-200">{error}</p> : null}

        <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
          <h2 className="text-2xl font-bold">Linked installations</h2>
          {!enabled ? (
            <p className="mt-4 text-slate-300">GitHub sign-in and installations are not enabled on this environment yet.</p>
          ) : installations.length === 0 ? (
            <p className="mt-4 text-slate-300">No GitHub installations are linked to your account yet.</p>
          ) : (
            <ul className="mt-6 space-y-6">
              {installations.map((installation) => (
                <li key={installation.installationId} className="rounded-2xl border border-white/10 bg-black/10 p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="font-bold">{installation.accountLogin}</p>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-300">{installation.accountType}</span>
                    {installation.suspended ? <span className="rounded-full bg-red-400/10 px-3 py-1 text-xs text-red-200">Suspended on GitHub</span> : null}
                  </div>
                  {installation.repositories.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-sm text-slate-300">
                      {installation.repositories.map((repository) => (
                        <li key={repository.id} className="font-mono">{repository.fullName}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-slate-400">No repositories are selected for this installation.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {enabled ? (
            <a
              href={githubInstallStartUrl(API_BASE)}
              className="mt-8 inline-flex rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-200"
            >
              {busy ? "Linking…" : "Install the SolveLang app"}
            </a>
          ) : null}
          <p className="mt-4 text-sm text-slate-400">The button takes you to GitHub to pick the account and repositories. GitHub returns you here afterwards and the installation is linked to your account.</p>
        </section>
      </div>
    </main>
  );
}
