"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CustomerApiError,
  type CustomerDashboard,
  customerApi,
  normalizeApiBase,
} from "../account/core/customer-api";
import {
  PRODUCT_APP_INSTALL_URL,
  type ConnectedRepository,
  type InstallationRepositories,
  type RepoAuditSummary,
  connectAuditPath,
  connectRepositoriesPath,
  parseInstallationId,
  parseRepoSlug,
} from "./core/repo-connect";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);

type SessionState = "checking" | "signed-in" | "signed-out";

// "Connect a repository with GitHub" — the second way into the
// repository audit, next to the archive upload. Connecting is the
// sign-in: the button sends the customer to the branded SolveLang
// Process Solution app's install flow on GitHub, where they
// authenticate and choose repositories. The audit half below is
// for signed-in customers: it reads the connected repo's summary
// through the api-access proxy (/customer/connect/*), which stays
// dark (503) until the merge-governance service is configured for
// the product app — rendered here as a friendly "being switched
// on" state, not an error.
export function RepositoryConnectPanel() {
  const startedRef = useRef(false);
  const [session, setSession] = useState<SessionState>("checking");
  const [installationRaw, setInstallationRaw] = useState("");
  const [repoRaw, setRepoRaw] = useState("");
  const [repositories, setRepositories] = useState<ConnectedRepository[] | null>(null);
  const [audit, setAudit] = useState<RepoAuditSummary | null>(null);
  const [busy, setBusy] = useState<"repos" | "audit" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;
    async function probeSession() {
      try {
        await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
        if (active) setSession("signed-in");
      } catch {
        if (active) setSession("signed-out");
      }
    }
    void probeSession();
    return () => { active = false; };
  }, []);

  function describeFailure(caught: unknown): void {
    if (caught instanceof CustomerApiError && caught.status === 503) {
      setNotice("Repository connect is being switched on. The GitHub app connection is not live yet — the archive upload below still works.");
      setError("");
      return;
    }
    if (caught instanceof CustomerApiError && caught.status === 401) {
      setSession("signed-out");
      setError("");
      return;
    }
    setNotice("");
    setError(caught instanceof Error ? caught.message : "The connected repository could not be read.");
  }

  async function loadRepositories() {
    const installationId = parseInstallationId(installationRaw);
    if (installationId === null) {
      setError("Enter the installation ID from your GitHub app installation.");
      return;
    }
    setBusy("repos");
    setError("");
    setNotice("");
    try {
      const payload = await customerApi<InstallationRepositories>(
        API_BASE,
        connectRepositoriesPath(installationId),
        { method: "GET" },
      );
      setRepositories(payload.repositories);
      if (payload.repositories.length === 0) {
        setNotice("That installation does not expose any repositories yet. Check the installation ID, or connect a repository first.");
      }
    } catch (caught) {
      describeFailure(caught);
    } finally {
      setBusy(null);
    }
  }

  async function runAudit() {
    const installationId = parseInstallationId(installationRaw);
    if (installationId === null) {
      setError("Enter the installation ID from your GitHub app installation.");
      return;
    }
    const slug = parseRepoSlug(repoRaw);
    if (!slug) {
      setError("Enter the repository as owner/name, for example acme/alpha.");
      return;
    }
    setBusy("audit");
    setError("");
    setNotice("");
    try {
      const payload = await customerApi<RepoAuditSummary>(
        API_BASE,
        connectAuditPath(installationId, slug.owner, slug.repo),
        { method: "GET" },
      );
      setAudit(payload);
    } catch (caught) {
      describeFailure(caught);
    } finally {
      setBusy(null);
    }
  }

  const inputClasses = "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none";
  const labelClasses = "block text-sm font-semibold text-slate-800";

  return (
    <section className="mb-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/40 sm:p-8" aria-label="Connect a repository with GitHub">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Connect a repository</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">Connect a repository with GitHub</h2>
      <p className="mt-3 max-w-2xl leading-7 text-slate-600">
        Install the SolveLang Process Solution app on a repository and the audit runs on the connected
        repo — the app connection is the sign-in, and nothing is uploaded. Prefer not to connect?
        The archive upload below stays as the no-connect option.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a
          href={PRODUCT_APP_INSTALL_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Connect with GitHub
        </a>
        <span className="text-sm text-slate-500">You choose the repositories on GitHub. Read-only audit summary; no file contents leave GitHub.</span>
      </div>

      <div className="mt-8 border-t border-slate-200 pt-6">
        <h3 className="text-lg font-semibold tracking-tight">Audit a connected repository</h3>
        {session === "checking" ? (
          <p className="mt-3 text-sm text-slate-500">Checking your session…</p>
        ) : session === "signed-out" ? (
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Sign in to read a connected repository&apos;s audit.{" "}
            <Link href="/account/api-keys/" className="font-semibold text-blue-700 hover:text-blue-900">Sign in to your account</Link>
          </p>
        ) : (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClasses} htmlFor="connect-installation-id">Installation ID</label>
                <input
                  id="connect-installation-id"
                  className={`${inputClasses} mt-2`}
                  inputMode="numeric"
                  placeholder="e.g. 179351888"
                  value={installationRaw}
                  onChange={(event) => setInstallationRaw(event.target.value)}
                />
              </div>
              <div>
                <label className={labelClasses} htmlFor="connect-repo">Repository (owner/name)</label>
                <input
                  id="connect-repo"
                  className={`${inputClasses} mt-2`}
                  placeholder="e.g. acme/alpha"
                  value={repoRaw}
                  onChange={(event) => setRepoRaw(event.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void loadRepositories()}
                disabled={busy !== null}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                {busy === "repos" ? "Loading…" : "List connected repositories"}
              </button>
              <button
                type="button"
                onClick={() => void runAudit()}
                disabled={busy !== null}
                className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busy === "audit" ? "Reading…" : "Run repository audit"}
              </button>
            </div>

            {repositories && repositories.length > 0 ? (
              <ul className="mt-5 space-y-2">
                {repositories.map((repo) => (
                  <li key={repo.fullName}>
                    <button
                      type="button"
                      onClick={() => setRepoRaw(repo.fullName)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:border-slate-400"
                    >
                      <span className="text-sm font-semibold text-slate-900">{repo.fullName}</span>
                      <span className="text-xs text-slate-500">
                        {repo.private ? "Private" : "Public"} · default branch {repo.defaultBranch ?? "unknown"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {audit ? (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-base font-semibold text-slate-900">{audit.repo.fullName}</p>
                  <p className="text-xs text-slate-500">
                    {audit.repo.private ? "Private" : "Public"} · default branch {audit.repo.defaultBranch ?? "unknown"}
                  </p>
                </div>
                {audit.repo.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{audit.repo.description}</p> : null}
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div className="rounded-xl bg-white p-3">
                    <dt className="text-slate-500">Open pull requests</dt>
                    <dd className="mt-1 text-lg font-semibold text-slate-900">{audit.queue.openPrs}</dd>
                  </div>
                  <div className="rounded-xl bg-white p-3">
                    <dt className="text-slate-500">Draft pull requests</dt>
                    <dd className="mt-1 text-lg font-semibold text-slate-900">{audit.queue.drafts}</dd>
                  </div>
                  <div className="rounded-xl bg-white p-3">
                    <dt className="text-slate-500">Checks reachable</dt>
                    <dd className="mt-1 text-lg font-semibold text-slate-900">{audit.checksReachable ? "Yes" : "No"}</dd>
                  </div>
                </dl>
                {audit.languages.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {audit.languages.map((language) => (
                      <span key={language} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">{language}</span>
                    ))}
                  </div>
                ) : null}
                {audit.tree.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-sm font-semibold text-slate-800">Top level</p>
                    <ul className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
                      {audit.tree.map((entry) => (
                        <li key={entry.name} className="flex justify-between gap-3 rounded-lg bg-white px-3 py-2">
                          <span className="break-all">{entry.name}</span>
                          <span className="text-xs uppercase tracking-wide text-slate-400">{entry.type === "tree" ? "Folder" : "File"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
        {notice ? <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-medium text-blue-900">{notice}</div> : null}
        {error ? <div role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{error}</div> : null}
      </div>
    </section>
  );
}
