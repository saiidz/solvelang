// Pure helpers for the repository-audit page's "connect a
// repository" flows — the GitHub app-install flow and the
// hand-typed platform doors (GitLab, Azure DevOps, Bitbucket,
// Forgejo / Gitea). Kept free of window/fetch so the studio tests
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

// ---------------------------------------------------------------------------
// Platform doors: GitLab, Azure DevOps, Bitbucket, Forgejo / Gitea.
//
// These platforms have no app-install flow here: the connection is
// a set of identifiers the customer types by hand, registered under
// their signed-in account through the api-access platform
// connections routes (/customer/platform-connections). Registering
// saves the connection so it is listed as theirs; it runs nothing
// against the repository. The audit summary runs today only for
// GitHub-connected repositories — for these platforms the audit
// action answers with the awaiting-configuration status the
// service returns, and the copy below says exactly that. The
// client-side validation mirrors the server's rules so the panel
// can ask again immediately; the server stays authoritative.

export type AuditPlatformId = "github" | "gitlab" | "azure" | "bitbucket" | "forge";
export type ConnectionPlatformId = Exclude<AuditPlatformId, "github">;

export const AUDIT_PLATFORMS: { id: AuditPlatformId; label: string }[] = [
  { id: "github", label: "GitHub" },
  { id: "gitlab", label: "GitLab" },
  { id: "azure", label: "Azure DevOps" },
  { id: "bitbucket", label: "Bitbucket" },
  { id: "forge", label: "Forgejo / Gitea" },
];

export const PLATFORM_AUDIT_AWAITING_STATE = "awaiting_configuration";

export const PLATFORM_AUDIT_AWAITING_COPY =
  "Connection saved — the first live audit for this platform is enabled when its access is configured. Nothing has been run against your repository yet.";

export function platformConnectionsPath(): string {
  return "/customer/platform-connections";
}

export function platformConnectionAuditPath(): string {
  return "/customer/platform-connections/audit";
}

export type PlatformConnection = {
  connectionId: string;
  platform: ConnectionPlatformId;
  repositories: string[];
  tokenStored: boolean;
  tokenFingerprint: string | null;
  auditState: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  workspace?: string;
};

const CONNECTION_PLATFORM_IDS: ConnectionPlatformId[] = ["gitlab", "azure", "bitbucket", "forge"];

// Defensive read of the list response: anything that is not a
// well-shaped connection entry is dropped rather than rendered,
// so a surprising payload degrades to a shorter list, never to a
// broken panel.
export function normalizePlatformConnections(raw: unknown): PlatformConnection[] {
  if (!raw || typeof raw !== "object") return [];
  const entries = (raw as { connections?: unknown }).connections;
  if (!Array.isArray(entries)) return [];
  const connections: PlatformConnection[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.connectionId !== "string" || !candidate.connectionId) continue;
    if (!CONNECTION_PLATFORM_IDS.includes(candidate.platform as ConnectionPlatformId)) continue;
    if (!Array.isArray(candidate.repositories)) continue;
    const repositories = candidate.repositories.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (repositories.length === 0) continue;
    const connection: PlatformConnection = {
      connectionId: candidate.connectionId,
      platform: candidate.platform as ConnectionPlatformId,
      repositories,
      tokenStored: candidate.tokenStored === true,
      tokenFingerprint: typeof candidate.tokenFingerprint === "string" ? candidate.tokenFingerprint : null,
      auditState: typeof candidate.auditState === "string" ? candidate.auditState : PLATFORM_AUDIT_AWAITING_STATE,
    };
    if (typeof candidate.baseUrl === "string") connection.baseUrl = candidate.baseUrl;
    if (typeof candidate.organization === "string") connection.organization = candidate.organization;
    if (typeof candidate.project === "string") connection.project = candidate.project;
    if (typeof candidate.workspace === "string") connection.workspace = candidate.workspace;
    connections.push(connection);
  }
  return connections;
}

// The line a connection is listed under: where it lives, in the
// platform's own terms.
export function platformConnectionTitle(connection: PlatformConnection): string {
  if (connection.platform === "azure") {
    return `${connection.organization ?? ""} / ${connection.project ?? ""}`;
  }
  if (connection.platform === "bitbucket") {
    return connection.workspace ?? "";
  }
  return connection.baseUrl ?? "";
}

export function platformAuditStateCopy(auditState: string): string {
  if (auditState === PLATFORM_AUDIT_AWAITING_STATE) return PLATFORM_AUDIT_AWAITING_COPY;
  return auditState;
}

// One repository per line in the form's textarea: trimmed,
// de-duplicated, empties dropped.
export function parseRepositoryLines(value: string): string[] {
  const seen = new Set<string>();
  const repositories: string[] = [];
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      repositories.push(trimmed);
    }
  }
  return repositories;
}

function isHttpsBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
}

function isGitLabProjectPath(value: string): boolean {
  const parts = value.split("/");
  return parts.length >= 2 && parts.every((part) => REPO_SEGMENT.test(part));
}

function isAzureName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64 && !/[/\\]/.test(trimmed);
}

export type PlatformConnectionDraft = {
  platform: ConnectionPlatformId;
  baseUrl: string;
  organization: string;
  project: string;
  workspace: string;
  repositories: string[];
  token: string;
};

export type PlatformConnectionPayloadResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

// Builds the register payload for one platform's door, or the
// exact reason the panel should ask again. Mirrors the server's
// rules (the server stays authoritative): instance URLs are
// https with no credentials, GitLab projects are group paths,
// Forgejo / Gitea and Bitbucket repositories are owner/slug
// shapes in their own terms, Azure names carry no separators.
export function buildPlatformConnectionPayload(
  draft: PlatformConnectionDraft,
): PlatformConnectionPayloadResult {
  if (draft.repositories.length === 0) {
    return { ok: false, error: "Enter at least one repository — one per line." };
  }
  if (draft.repositories.length > 25) {
    return { ok: false, error: "Enter at most 25 repositories per connection." };
  }
  const token = draft.token.trim();
  if (token && (token.length < 8 || token.length > 8192)) {
    return { ok: false, error: "That access token does not look complete — check it and try again, or leave it empty." };
  }
  const payload: Record<string, unknown> = { platform: draft.platform, repositories: draft.repositories };
  if (token) payload.token = token;

  if (draft.platform === "gitlab" || draft.platform === "forge") {
    const label = draft.platform === "gitlab" ? "GitLab" : "Forgejo / Gitea";
    if (!isHttpsBaseUrl(draft.baseUrl)) {
      return { ok: false, error: `Enter the ${label} instance URL, starting with https://` };
    }
    payload.baseUrl = draft.baseUrl.trim().replace(/\/+$/, "");
  }
  if (draft.platform === "gitlab") {
    if (!draft.repositories.every(isGitLabProjectPath)) {
      return { ok: false, error: "Enter GitLab projects as group/project — a group alone is not a project." };
    }
  }
  if (draft.platform === "forge") {
    if (!draft.repositories.every((value) => parseRepoSlug(value) !== null)) {
      return { ok: false, error: "Enter repositories as owner/name, for example acme/alpha." };
    }
  }
  if (draft.platform === "azure") {
    if (!isAzureName(draft.organization)) {
      return { ok: false, error: "Enter the Azure DevOps organization name." };
    }
    if (!isAzureName(draft.project)) {
      return { ok: false, error: "Enter the Azure DevOps project name." };
    }
    if (!draft.repositories.every(isAzureName)) {
      return { ok: false, error: "Enter repository names without slashes — one per line." };
    }
    payload.organization = draft.organization.trim();
    payload.project = draft.project.trim();
  }
  if (draft.platform === "bitbucket") {
    if (!REPO_SEGMENT.test(draft.workspace.trim())) {
      return { ok: false, error: "Enter the Bitbucket workspace slug." };
    }
    if (!draft.repositories.every((value) => REPO_SEGMENT.test(value))) {
      return { ok: false, error: "Enter repository slugs without slashes — one per line." };
    }
    payload.workspace = draft.workspace.trim();
  }
  return { ok: true, payload };
}

// ---------------------------------------------------------------------------
// Connected-list read states.
//
// A failed read and an empty list are different facts and render
// differently: the "no repositories are connected" copy may only
// appear when every read SUCCEEDED and found nothing. Any failed
// read shows the could-not-be-loaded state (with a retry) instead —
// a loading problem is never dressed up as an empty account.

export type ConnectionsReadState = "loading" | "ready" | "failed";

export function connectionsReadFailed(
  githubRead: ConnectionsReadState,
  platformRead: ConnectionsReadState,
): boolean {
  return githubRead === "failed" || platformRead === "failed";
}

export function noConnectionsApplies(
  githubRead: ConnectionsReadState,
  platformRead: ConnectionsReadState,
  githubCount: number,
  platformCount: number,
): boolean {
  return githubRead === "ready" && platformRead === "ready" && githubCount === 0 && platformCount === 0;
}
