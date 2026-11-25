// Pure helpers for the repository-audit page's "connect a repository
// with GitHub" flow. Kept free of window/fetch so the studio tests
// can pin them: the panel component builds on these, exactly like
// the account pages build on account/core.
//
// Connecting IS the sign-in: the customer installs the branded
// SolveLang Process Solution GitHub App on their repositories (the
// install flow on github.com is where they authenticate and pick
// repos). Afterwards the panel discovers what the platform already
// holds for the signed-in customer — the session bindings read
// (/customer/github/bindings, the same data the account page and
// the Live Center show) names each connected repository together
// with its installation, so nothing has to be typed. The audit
// reads themselves go through the api-access proxy routes
// (/customer/connect/*), which stay dark (503) until the
// merge-governance pilot service is configured for the product
// app — the panel renders that as a friendly "being switched on"
// state, never as an error. The typed installation ID remains
// only as a manual fallback for installations the bindings read
// cannot see.

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

export function connectBindingsPath(): string {
  return "/customer/github/bindings";
}

export type BoundAuditSelection = {
  installationId: number;
  owner: string;
  repo: string;
};

// One repository entry from the bindings read, shaped for the
// audit: the entry already carries its installation, so the
// selection is complete only when that installation id is a
// positive integer and the full name parses as owner/repo.
// Anything else is null — the panel then points at the manual
// fallback instead of guessing an identifier.
export function boundAuditSelection(repository: {
  fullName: string;
  installationId: number | null;
}): BoundAuditSelection | null {
  if (
    typeof repository.installationId !== "number"
    || !Number.isSafeInteger(repository.installationId)
    || repository.installationId <= 0
  ) {
    return null;
  }
  const slug = parseRepoSlug(repository.fullName);
  if (!slug) return null;
  return { installationId: repository.installationId, owner: slug.owner, repo: slug.repo };
}
