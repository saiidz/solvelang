// GitHub REST client for the verification service — only the surface
// the run loop needs, all of it under an installation token:
//   - read a file at a ref (the verification config at the base SHA,
//     the gate policy presence check is done on the cloned tree),
//   - read the PR (labels for the gate's override handling),
//   - list the head's check runs (receipt CI evidence + the settle
//     wait),
//   - create and complete the verification Check Run (with
//     annotations),
//   - post or update the single sticky receipt comment.
// Errors surface as GitHubClientError with the HTTP status only —
// GitHub error bodies are never propagated into logs or check output.

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "solvelang-verification";

export const CHECK_RUN_NAME = "SolveLang Verification";
export const COMMENT_MARKER = "<!-- solvelang-verification:report -->";

export class GitHubClientError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "GitHubClientError";
    this.status = status;
  }
}

export function createGitHubClient({ token, fetchImpl = fetch } = {}) {
  if (typeof token !== "string" || !token) {
    throw new Error("GitHub installation token is required.");
  }

  async function request(method, route, body) {
    let response;
    try {
      response = await fetchImpl(`${GITHUB_API_BASE}${route}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: "Bearer " + token,
          "x-github-api-version": GITHUB_API_VERSION,
          "user-agent": USER_AGENT,
          ...(body !== undefined
            ? { "content-type": "application/json" }
            : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new GitHubClientError(0, "github_request_failed");
    }
    if (!response.ok) {
      throw new GitHubClientError(response.status || 0, "github_request_failed");
    }
    if (response.status === 204) return null;
    return response.json().catch(() => null);
  }

  const repoRoute = (owner, repo) =>
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  return {
    async getPullRequest(owner, repo, number) {
      return request("GET", `${repoRoute(owner, repo)}/pulls/${number}`);
    },

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
        if (err instanceof GitHubClientError && err.status === 404) {
          return null;
        }
        throw err;
      }
      if (!payload || payload.encoding !== "base64" || typeof payload.content !== "string") {
        return null;
      }
      return Buffer.from(payload.content, "base64").toString("utf8");
    },

    async listCheckRuns(owner, repo, sha) {
      const runs = [];
      for (let page = 1; ; page += 1) {
        const payload = await request(
          "GET",
          `${repoRoute(owner, repo)}/commits/${sha}/check-runs?per_page=100&page=${page}`
        );
        const batch = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
        runs.push(...batch);
        if (batch.length < 100) return runs;
      }
    },

    async createCheckRun(owner, repo, { headSha, title, summary }) {
      return request("POST", `${repoRoute(owner, repo)}/check-runs`, {
        name: CHECK_RUN_NAME,
        head_sha: headSha,
        status: "in_progress",
        started_at: new Date().toISOString(),
        output: { title, summary },
      });
    },

    async completeCheckRun(owner, repo, checkRunId, { conclusion, title, summary, text, annotations }) {
      return request("PATCH", `${repoRoute(owner, repo)}/check-runs/${checkRunId}`, {
        status: "completed",
        conclusion,
        completed_at: new Date().toISOString(),
        output: {
          title,
          summary,
          ...(text ? { text } : {}),
          ...(Array.isArray(annotations) && annotations.length > 0
            ? { annotations }
            : {}),
        },
      });
    },

    // One sticky comment per PR, found by the marker; updated in
    // place on re-runs so a PR never accumulates receipt copies.
    async upsertReceiptComment(owner, repo, prNumber, body) {
      const comments = [];
      for (let page = 1; ; page += 1) {
        const batch = await request(
          "GET",
          `${repoRoute(owner, repo)}/issues/${prNumber}/comments?per_page=100&page=${page}`
        );
        const list = Array.isArray(batch) ? batch : [];
        comments.push(...list);
        if (list.length < 100) break;
      }
      const existing = comments.find(
        (comment) => typeof comment?.body === "string" && comment.body.includes(COMMENT_MARKER)
      );
      if (existing) {
        return request("PATCH", `${repoRoute(owner, repo)}/issues/comments/${existing.id}`, { body });
      }
      return request("POST", `${repoRoute(owner, repo)}/issues/${prNumber}/comments`, { body });
    },
  };
}
