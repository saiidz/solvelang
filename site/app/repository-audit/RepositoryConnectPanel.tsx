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
  type GitHubBindingsView,
  normalizeGitHubBindings,
} from "../account/core/github-auto-run";
import {
  PRODUCT_APP_INSTALL_URL,
  type ConnectedRepository,
  type InstallationRepositories,
  type RepoAuditSummary,
  boundAuditSelection,
  connectAuditPath,
  connectBindingsPath,
  connectRepositoriesPath,
  parseInstallationId,
  parseRepoSlug,
} from "./core/repo-connect";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);

type SessionState = "checking" | "signed-in" | "signed-out";

const NOT_CONNECTED_BINDINGS: GitHubBindingsView = {
  connected: false,
  accounts: [],
  repositories: [],
};

// "Connect a repository with GitHub" — the second way into the
// repository audit, next to the archive upload. Connecting is the
// sign-in: the button sends the customer to the branded SolveLang
// Process Solution app's install flow on GitHub, where they
// authenticate and choose repositories. The audit half below is
// for signed-in customers: it first discovers the repositories
// the platform already holds for their account through the
// session bindings read (/customer/github/bindings — the same
// data the account page and the Live Center show), so a connected
// repository is picked from a list, never identified by a typed
// installation ID. The audit itself reads the connected repo's
// summary through the api-access proxy (/customer/connect/*),
// which stays dark (503) until the merge-governance service is
// configured for the product app — rendered here as a friendly
// "being switched on" state, not an error. The typed installation
// ID remains below as a collapsed manual fallback for
// installations the bindings read cannot see.
export function RepositoryConnectPanel() {
  const startedRef = useRef(false);
  const discoveryRef = useRef(false);
  const [session, setSession] = useState<SessionState>("checking");
  const [bindings, setBindings] = useState<GitHubBindingsView | null>(null);
  const [selectedFullName, setSelectedFullName] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ConnectedRepository>>({});
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

  useEffect(() => {
    if (session !== "signed-in" || discoveryRef.current) return;
    discoveryRef.current = true;
    let active = true;
    async function discoverConnected() {
      let view: GitHubBindingsView;
      try {
        const raw = await customerApi<unknown>(API_BASE, connectBindingsPath(), { method: "GET" });
        view = normalizeGitHubBindings(raw);
      } catch {
        // The bindings read being unavailable means the connected
        // state cannot be shown yet: render the not-connected
        // state, never an error dump — the manual fallback below
        // still works.
        view = NOT_CONNECTED_BINDINGS;
      }
      if (!active) return;
      setBindings(view);
      if (view.repositories.length > 0) {
        setSelectedFullName((current) => current ?? view.repositories[0].fullName);
      }
      // Enrich the discovered list with the proxy's per-installation
      // details (private / default branch) where reachable. The
      // bindings entries alone are enough to run the audit, so a
      // failed enrichment is silent.
      const installationIds = [...new Set(
        view.repositories
          .map((repository) => repository.installationId)
          .filter((id): id is number => typeof id === "number"),
      )];
      const merged: Record<string, ConnectedRepository> = {};
      await Promise.all(installationIds.map(async (installationId) => {
        try {
          const payload = await customerApi<InstallationRepositories>(
            API_BASE,
            connectRepositoriesPath(installationId),
            { method: "GET" },
          );
          for (const repository of payload.repositories) merged[repository.fullName] = repository;
        } catch {
          // Details are decoration on the discovered list; the
          // audit runs from the bindings entry itself.
        }
      }));
      if (active && Object.keys(merged).length > 0) setDetails(merged);
    }
    void discoverConnected();
    return () => { active = false; };
  }, [session]);

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

  async function runAuditFor(installationId: number, owner: string, repo: string) {
    setBusy("audit");
    setError("");
    setNotice("");
    try {
      const payload = await customerApi<RepoAuditSummary>(
        API_BASE,
        connectAuditPath(installationId, owner, repo),
        { method: "GET" },
      );
      setAudit(payload);
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
    await runAuditFor(installationId, slug.owner, slug.repo);
  }

  async function runSelectedAudit() {
    const selected = bindings?.repositories.find((repository) => repository.fullName === selectedFullName);
    const selection = selected ? boundAuditSelection(selected) : null;
    if (!selection) {
      setError("That connected repository is missing its installation link. The manual entry below can still reach it.");
      return;
    }
    await runAuditFor(selection.installationId, selection.owner, selection.repo);
  }

  const inputClasses = "w-full rounded-xl border border-line-strong bg-panel px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";
  const labelClasses = "block text-sm font-semibold text-body";

  return (
    <section className="mb-8 rounded-[2rem] border border-line bg-panel p-6 shadow-xl shadow-slate-200/40 sm:p-8" aria-label="Connect a repository with GitHub">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Connect a repository</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">Connect a repository with GitHub</h2>
      <p className="mt-3 max-w-2xl leading-7 text-muted">
        Install the SolveLang Process Solution app on a repository and the audit runs on the connected
        repo — the app connection is the sign-in, and nothing is uploaded. Prefer not to connect?
        The archive upload below stays as the no-connect option.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a
          href={PRODUCT_APP_INSTALL_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl bg-canvas px-5 py-3 text-sm font-semibold text-ink hover:bg-panel-alt"
        >
          Connect with GitHub
        </a>
        <span className="text-sm text-muted">You choose the repositories on GitHub. Read-only audit summary; no file contents leave GitHub.</span>
      </div>

      <div className="mt-8 border-t border-line pt-6">
        <h3 className="text-lg font-semibold tracking-tight">Audit a connected repository</h3>
        {session === "checking" ? (
          <p className="mt-3 text-sm text-muted">Checking your session…</p>
        ) : session === "signed-out" ? (
          <p className="mt-3 text-sm leading-6 text-muted">
            Sign in to read a connected repository&apos;s audit.{" "}
            <Link href="/account/api-keys/" className="font-semibold text-accent hover:text-accent">Sign in to your account</Link>
          </p>
        ) : (
          <>
            {bindings === null ? (
              <p className="mt-3 text-sm text-muted">Loading your connected repositories…</p>
            ) : bindings.repositories.length > 0 ? (
              <>
                {bindings.accounts.length > 0 ? (
                  <p className="mt-3 text-sm text-muted">
                    Connected GitHub account:{" "}
                    <span className="font-semibold text-ink">{bindings.accounts.map((account) => account.login).join(", ")}</span>
                  </p>
                ) : null}
                <p className="mt-2 text-sm leading-6 text-muted">
                  These repositories are already connected to your account. Pick one and run its
                  audit — the connection already knows its installation, so there is nothing to type.
                </p>
                <ul className="mt-4 space-y-2">
                  {bindings.repositories.map((repository) => {
                    const detail = details[repository.fullName];
                    const selected = repository.fullName === selectedFullName;
                    return (
                      <li key={repository.fullName}>
                        <button
                          type="button"
                          onClick={() => setSelectedFullName(repository.fullName)}
                          aria-pressed={selected}
                          className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left ${selected ? "border-accent bg-canvas" : "border-line bg-canvas hover:border-line-strong"}`}
                        >
                          <span className="text-sm font-semibold text-ink">{repository.fullName}</span>
                          <span className="text-xs text-muted">
                            {detail ? `${detail.private ? "Private" : "Public"} · default branch ${detail.defaultBranch ?? "unknown"}` : selected ? "Selected" : "Connected"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void runSelectedAudit()}
                    disabled={busy !== null || selectedFullName === null}
                    className="rounded-xl bg-canvas px-4 py-2 text-sm font-semibold text-ink hover:bg-panel-alt disabled:opacity-60"
                  >
                    {busy === "audit" ? "Reading…" : "Run repository audit"}
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted">
                No repositories are connected to your account yet. Connect a repository with GitHub
                above and it will appear here for its audit — there is no installation ID to find
                or type.
              </p>
            )}

            <details className="mt-6">
              <summary className="cursor-pointer text-sm font-semibold text-body">
                Enter an installation ID manually
              </summary>
              <p className="mt-2 text-sm leading-6 text-muted">
                For an installation that does not appear above — for example one connected before
                your account was linked. The list above stays the normal way in.
              </p>
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
                  className="rounded-xl border border-line-strong bg-panel px-4 py-2 text-sm font-semibold text-body hover:bg-panel-alt disabled:opacity-60"
                >
                  {busy === "repos" ? "Loading…" : "List connected repositories"}
                </button>
                <button
                  type="button"
                  onClick={() => void runAudit()}
                  disabled={busy !== null}
                  className="rounded-xl bg-canvas px-4 py-2 text-sm font-semibold text-ink hover:bg-panel-alt disabled:opacity-60"
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
                        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-canvas px-4 py-3 text-left hover:border-line-strong"
                      >
                        <span className="text-sm font-semibold text-ink">{repo.fullName}</span>
                        <span className="text-xs text-muted">
                          {repo.private ? "Private" : "Public"} · default branch {repo.defaultBranch ?? "unknown"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </details>

            {audit ? (
              <div className="mt-6 rounded-2xl border border-line bg-canvas p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-base font-semibold text-ink">{audit.repo.fullName}</p>
                  <p className="text-xs text-muted">
                    {audit.repo.private ? "Private" : "Public"} · default branch {audit.repo.defaultBranch ?? "unknown"}
                  </p>
                </div>
                {audit.repo.description ? <p className="mt-2 text-sm leading-6 text-muted">{audit.repo.description}</p> : null}
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div className="rounded-xl bg-panel p-3">
                    <dt className="text-muted">Open pull requests</dt>
                    <dd className="mt-1 text-lg font-semibold text-ink">{audit.queue.openPrs}</dd>
                  </div>
                  <div className="rounded-xl bg-panel p-3">
                    <dt className="text-muted">Draft pull requests</dt>
                    <dd className="mt-1 text-lg font-semibold text-ink">{audit.queue.drafts}</dd>
                  </div>
                  <div className="rounded-xl bg-panel p-3">
                    <dt className="text-muted">Checks reachable</dt>
                    <dd className="mt-1 text-lg font-semibold text-ink">{audit.checksReachable ? "Yes" : "No"}</dd>
                  </div>
                </dl>
                {audit.languages.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {audit.languages.map((language) => (
                      <span key={language} className="rounded-full border border-line bg-panel px-3 py-1 text-xs font-medium text-body">{language}</span>
                    ))}
                  </div>
                ) : null}
                {audit.tree.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-sm font-semibold text-body">Top level</p>
                    <ul className="mt-2 grid gap-1 text-sm text-muted sm:grid-cols-2">
                      {audit.tree.map((entry) => (
                        <li key={entry.name} className="flex justify-between gap-3 rounded-lg bg-panel px-3 py-2">
                          <span className="break-all">{entry.name}</span>
                          <span className="text-xs uppercase tracking-wide text-muted">{entry.type === "tree" ? "Folder" : "File"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
        {notice ? <div className="mt-5 rounded-2xl border border-accent bg-accent-soft p-4 text-sm font-medium text-accent">{notice}</div> : null}
        {error ? <div role="alert" className="mt-5 rounded-2xl border border-danger bg-danger-soft p-4 text-sm font-medium text-danger">{error}</div> : null}
      </div>
    </section>
  );
}
