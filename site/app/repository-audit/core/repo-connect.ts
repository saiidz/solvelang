// Pure helpers for the repository-audit page's "connect a repository
// with GitHub" flow. Kept free of window/fetch so the studio tests
// can pin them: the panel component builds on these, exactly like
// the account pages build on account/core.
//
// Connecting IS the sign-in: the customer installs the branded
// SolveLang Process Solution GitHub App on their repositories (the
// install flow on github.com is where they authenticate and pick
// repos). Afterwards the audit reads go through the api-access
// proxy routes (/customer/connect/*), which stay dark (503) until
// the merge-governance pilot service is configured for the product
// app — the panel renders that as a friendly "being switched on"
// state, never as an error.

export const PRODUCT_APP_INSTALL_URL =
  "https://github.com/apps/solvelang-process-solution/installations/new";

export type ConnectedRepository = {
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string | null;
};

export type InstallationRepositories = {
  installationId: number;
  repositories: ConnectedRepository[];
};

export type RepoAuditSummary = {
  installationId: number;
  repo: {
    name: string;
    fullName: string;
    private: boolean;
    defaultBranch: string | null;
    description: string | null;
  };
  queue: { openPrs: number; drafts: number };
  tree: { name: string; type: string }[];
  languages: string[];
  checksReachable: boolean;
};

const REPO_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

// Accepts exactly "owner/repo" (one slash, two GitHub-shaped
// segments). Anything else — a URL, a bare repo name, extra path
// parts — is null so the panel can ask again instead of guessing.
export function parseRepoSlug(value: string): { owner: string; repo: string } | null {
  const parts = value.trim().split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!REPO_SEGMENT.test(owner) || !REPO_SEGMENT.test(repo)) return null;
  return { owner, repo };
}

export function parseInstallationId(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = Number(trimmed);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function connectRepositoriesPath(installationId: number): string {
  return `/customer/connect/repositories?installationId=${installationId}`;
}

export function connectAuditPath(installationId: number, owner: string, repo: string): string {
  const query = `installationId=${installationId}&owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`;
  return `/customer/connect/audit?${query}`;
}
