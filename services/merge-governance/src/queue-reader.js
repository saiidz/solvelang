// Queue reader for the merge-governance pilot.
//
// Reads a repository's open pull requests from the GitHub API using the
// global fetch available in Node 22 — no extra dependencies. The fetch
// implementation is injectable so tests and local proof runs can stub it.

const GITHUB_API_BASE = "https://api.github.com";

async function githubGet(path, { token, fetchImpl }) {
  const res = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
    method: "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "solvelang-merge-governance-pilot",
    },
  });
  if (!res.ok) {
    const err = new Error(`github_api_error:${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export function mapPullRequest(pr) {
  return {
    number: pr.number,
    title: pr.title,
    headSha: pr.head ? pr.head.sha : null,
    baseRef: pr.base ? pr.base.ref : null,
    draft: Boolean(pr.draft),
    mergeableState: pr.mergeable_state ?? null,
    updatedAt: pr.updated_at,
  };
}

// Fetches repo metadata plus the first page of open pull requests
// (per_page=100 — sufficient for the pilot skeleton).
export async function readRepoQueue({ owner, repo, token, fetchImpl = fetch }) {
  if (!owner || !repo) throw new Error("owner_and_repo_required");
  if (!token) throw new Error("github_token_not_configured");
  const repoMeta = await githubGet(`/repos/${owner}/${repo}`, { token, fetchImpl });
  const pulls = await githubGet(
    `/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
    { token, fetchImpl }
  );
  return {
    repo: {
      fullName: repoMeta.full_name,
      defaultBranch: repoMeta.default_branch,
    },
    prs: (pulls || []).map(mapPullRequest),
  };
}

// Produces the state-model records for a snapshot plus its summary.
// Records carry the fields state-store.putQueueSnapshot persists.
export function buildQueueSnapshot(tenantId, owner, repo, prs, now = new Date()) {
  const repoFullName = `${owner}/${repo}`;
  const generatedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const records = prs.map((pr) => ({
    prNumber: pr.number,
    title: pr.title,
    headSha: pr.headSha,
    baseRef: pr.baseRef,
    draft: Boolean(pr.draft),
    state: pr.draft ? "draft" : "queued",
    updatedAt: pr.updatedAt,
  }));
  const summary = {
    openPrs: prs.length,
    drafts: prs.filter((pr) => pr.draft).length,
    paused: false,
  };
  return {
    tenantId,
    repo: repoFullName,
    generatedAt,
    summary,
    records,
    prs,
  };
}

// Resolves the GitHub credential for one repo read, in priority order:
//
//   1. A GitHub App installation token — when the repo is bound to an
//      installation (installationId set) AND app auth is configured.
//      Minting failures throw the typed GitHubAppAuthError from
//      github-app-auth.js; the handler maps them to a sanitized 502 and
//      no GitHub response detail ever reaches callers.
//   2. The static read token, when configured.
//   3. null — nothing usable is configured; callers fail closed (503).
//
// The installation id may arrive as a number (DynamoDB record / parsed
// repo spec) or as a numeric string; anything else counts as unbound.
export async function resolveRepoToken({ installationId, staticToken, appAuth } = {}) {
  const id = Number(installationId);
  if (Number.isSafeInteger(id) && id > 0 && appAuth) {
    return appAuth.getInstallationToken(id);
  }
  return staticToken || null;
}
