import { ApiAccessError } from "./service.js";

// Session-gated proxy to the merge-governance pilot service's
// product-app connect reads ("connect a repository by app sign-in").
//
// The pilot service (private repo saiidz/solvelang-merge-governance)
// owns the branded product app's credentials and does the GitHub
// reads; this service only forwards the signed-in customer's
// request server-side with the pilot admin token, so the token
// never reaches the browser. The client is constructed only when
// BOTH the base URL and the admin token are configured (see
// config.js): a partial pair leaves the /customer/connect/* routes
// dark with 503, never half-wired.
//
// Upstream errors are sanitized exactly like the pilot service
// sanitizes GitHub's: a 503 from upstream (the product app not
// configured there yet) stays a 503 so the site can show its
// "being switched on" state; anything else upstream becomes a 502.

const REPO_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function createMergeGovernanceConnectService({ baseUrl, adminToken, fetchImpl = fetch } = {}) {
  const base = typeof baseUrl === "string" ? baseUrl.replace(/\/+$/, "") : "";
  if (!base || typeof adminToken !== "string" || !adminToken) {
    throw new Error("Merge Governance connect requires a base URL and an admin token.");
  }

  function cleanInstallationId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new ApiAccessError(400, "invalid_request", "A valid installation ID is required.");
    }
    return id;
  }

  function cleanSegment(value, label) {
    if (typeof value !== "string" || !REPO_SEGMENT.test(value)) {
      throw new ApiAccessError(400, "invalid_request", `A valid ${label} is required.`);
    }
    return value;
  }

  async function upstream(path) {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: "GET",
        headers: { accept: "application/json", "x-admin-token": adminToken },
      });
    } catch {
      throw new ApiAccessError(502, "merge_governance_unavailable", "The merge governance service could not be reached.");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 503) {
        const code = payload?.error === "product_app_not_configured"
          ? "product_app_not_configured"
          : "merge_governance_not_configured";
        throw new ApiAccessError(503, code, "Repository connect is being switched on.");
      }
      if (response.status === 400) {
        throw new ApiAccessError(400, "invalid_request", "The connect request was not valid.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new ApiAccessError(502, "merge_governance_unavailable", "The merge governance service refused the request.");
      }
      throw new ApiAccessError(502, "merge_governance_unavailable", "The merge governance service could not complete the request.");
    }
    return payload;
  }

  return {
    async listRepositories(installationId) {
      const id = cleanInstallationId(installationId);
      return upstream(`/apps/product/installations/${id}/repositories`);
    },
    async getAudit({ installationId, owner, repo } = {}) {
      const id = cleanInstallationId(installationId);
      const cleanOwner = cleanSegment(owner, "repository owner");
      const cleanRepo = cleanSegment(repo, "repository name");
      const query = `owner=${encodeURIComponent(cleanOwner)}&repo=${encodeURIComponent(cleanRepo)}`;
      return upstream(`/apps/product/installations/${id}/audit?${query}`);
    },
  };
}
