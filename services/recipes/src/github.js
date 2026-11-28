// GitHub REST client for the recipes service — only the surface the
// license-headers executor needs, all of it under ONE injected token
// (in production: a SolveLang Process Solution App installation
// token, the identity class the license-headers recipe runs under).
// Mirrors services/verification/src/github.js discipline: errors
// surface as GitHubClientError with the HTTP status only — GitHub
// error bodies are never propagated into logs, records or receipts.

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "solvelang-recipes";

export class RecipesGitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "RecipesGitHubError";
    this.status = status;
  }
}

export function splitRepo(repo) {
  const [owner, name] = String(repo || "").split("/");
  if (!owner || !name) throw new Error("repo_invalid");
  return { owner, name };
}

export function createRecipesGitHubClient({ token, fetchImpl = fetch } = {}) {
  if (typeof token !== "string" || !token) {
    throw new Error("GitHub token is required.");
  }

  async function request(method, route, body) {
    let response;
    try {
      response = await fetchImpl(`${GITHUB_API_BASE}${route}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": GITHUB_API_VERSION,
          "user-agent": USER_AGENT,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new RecipesGitHubError(0, "github_request_failed");
    }
    if (!response.ok) {
      throw new RecipesGitHubError(response.status || 0, "github_request_failed");
    }
    if (response.status === 204) return null;
    return response.json().catch(() => null);
  }

  const repoRoute = (owner, repo) =>
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  return {
    // Decoded text of a file at a ref, or null when it does not exist.
    async getFileTextAtRef(owner, repo, path, ref) {
      let payload;
      try {
        payload = await request(
          "GET",
          `${repoRoute(owner, repo)}/contents/${path
            .split("/")
            .map(encodeURIComponent)
            .join("/")}?ref=${encodeURIComponent(ref)}`
        );
      } catch (err) {
        if (err instanceof RecipesGitHubError && err.status === 404) return null;
        throw err;
      }
      if (!payload || payload.encoding !== "base64" || typeof payload.content !== "string") {
        return null;
      }
      return Buffer.from(payload.content, "base64").toString("utf8");
    },

    // All blob paths in the tree at a ref (recursive).
    async listBlobPaths(owner, repo, ref) {
      const payload = await request(
        "GET",
        `${repoRoute(owner, repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`
      );
      const tree = Array.isArray(payload?.tree) ? payload.tree : [];
      return tree.filter((e) => e?.type === "blob" && typeof e.path === "string").map((e) => e.path);
    },

    // Raw bytes of a file at a ref, or null when it does not exist.
    // Bytes (not text) so the executor itself grades undecodable /
    // binary files as unverified instead of the client guessing.
    async getFileBytesAtRef(owner, repo, path, ref) {
      let payload;
      try {
        payload = await request(
          "GET",
          `${repoRoute(owner, repo)}/contents/${path
            .split("/")
            .map(encodeURIComponent)
            .join("/")}?ref=${encodeURIComponent(ref)}`
        );
      } catch (err) {
        if (err instanceof RecipesGitHubError && err.status === 404) return null;
        throw err;
      }
      if (!payload || payload.encoding !== "base64" || typeof payload.content !== "string") {
        return null;
      }
      return Buffer.from(payload.content, "base64");
    },

    async getRefSha(owner, repo, ref) {
      const payload = await request("GET", `${repoRoute(owner, repo)}/git/ref/${ref}`);
      return payload?.object?.sha ?? null;
    },

    async getCommitTreeSha(owner, repo, commitSha) {
      const payload = await request(
        "GET",
        `${repoRoute(owner, repo)}/git/commits/${encodeURIComponent(commitSha)}`
      );
      return payload?.tree?.sha ?? null;
    },

    // One governed fix commit + PR, via the Git Data API: blobs for
    // the changed files only, a tree based on the base tree, one
    // commit, one branch ref, one pull request. Returns the PR's
    // number, URL and the ACTUAL author login GitHub recorded, so
    // the executor reports the identity that really acted.
    async createFixPullRequest(owner, repo, { baseSha, branch, changes, title, body }) {
      const baseTreeSha = await this.getCommitTreeSha(owner, repo, baseSha);
      const treeEntries = [];
      for (const change of changes) {
        const blob = await request("POST", `${repoRoute(owner, repo)}/git/blobs`, {
          content: Buffer.from(change.content, "utf8").toString("base64"),
          encoding: "base64",
        });
        treeEntries.push({ path: change.path, mode: "100644", type: "blob", sha: blob.sha });
      }
      const tree = await request("POST", `${repoRoute(owner, repo)}/git/trees`, {
        base_tree: baseTreeSha,
        tree: treeEntries,
      });
      const commit = await request("POST", `${repoRoute(owner, repo)}/git/commits`, {
        message: title,
        tree: tree.sha,
        parents: [baseSha],
      });
      await request("POST", `${repoRoute(owner, repo)}/git/refs`, {
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
      });
      const pr = await request("POST", `${repoRoute(owner, repo)}/pulls`, {
        title,
        body,
        head: branch,
        base: "main",
      });
      return {
        number: pr?.number ?? null,
        url: pr?.html_url ?? null,
        authorLogin: pr?.user?.login ?? null,
        commitSha: commit.sha,
      };
    },
  };
}
