import { ApiAccessError } from "./service.js";

// GitHub bindings read for the signed-in customer surface
// (zero-step onboarding, S5b). The customer-facing route in
// api-handler.js is session-gated and supplies the tenant — the
// session's accountId, never a client-supplied id; this service
// owns only the upstream call to the Merge Governance service's
// bindings read:
//
//   GET {baseUrl}/bindings/by-tenant?tenantId=<session tenant>
//   header: x-admin-token: {adminToken}
//   -> { installations: [...], repos: [{ repo, installationId, boundVia }] }
//
// Config mirrors the Merge Governance pilot pointers parsed in
// config.js (mergeGovernanceService): MGOV_PILOT_BASE_URL +
// MGOV_ADMIN_TOKEN. The pair enables the read only when BOTH are
// present — the same fail-closed discipline as live-center.js:
// when it is not configured, the read throws 503
// bindings_unavailable and no upstream call is ever attempted.
// Any upstream transport failure, non-2xx status, or unparseable
// body maps to the same 503 — the caller never sees upstream
// internals.
//
// The upstream payload is normalized here, not passed through:
// extra upstream fields are dropped, `repos[].repo` becomes
// `repositories[].fullName`, `boundVia` is dropped, and
// `connected` is true exactly when at least one repository is
// bound for the tenant.

export function createGitHubBindingsService({ config, baseUrl, adminToken, enabled, fetchImpl = fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const cfg = config ?? { baseUrl, adminToken, enabled };
  const pairPresent = Boolean(cfg?.baseUrl && cfg?.adminToken);
  // mergeGovernanceService config already folds the pair into
  // `enabled`; a caller passing a bare { baseUrl, adminToken }
  // pair (merge-governance-connect style) is enabled by the pair
  // itself. Either way, a partial pair never enables the read.
  const isEnabled = pairPresent && cfg?.enabled !== false && Boolean(cfg?.enabled ?? pairPresent);

  function unavailable() {
    return new ApiAccessError(503, "bindings_unavailable", "Bindings are unavailable.");
  }

  return {
    async getBindings(tenantId) {
      if (!isEnabled) throw unavailable();
      if (typeof tenantId !== "string" || !tenantId) throw unavailable();
      const base = String(cfg.baseUrl).replace(/\/+$/, "");
      const url = `${base}/bindings/by-tenant?tenantId=${encodeURIComponent(tenantId)}`;
      let upstream;
      try {
        upstream = await fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json", "x-admin-token": cfg.adminToken },
        });
      } catch {
        throw unavailable();
      }
      if (!upstream || upstream.ok !== true) throw unavailable();
      let payload;
      try {
        payload = await upstream.json();
      } catch {
        throw unavailable();
      }
      const installationsRaw = Array.isArray(payload?.installations) ? payload.installations : [];
      const reposRaw = Array.isArray(payload?.repos) ? payload.repos : [];
      const installations = installationsRaw.map((installation) => ({
        accountLogin: installation?.accountLogin,
        state: installation?.state,
      }));
      const repositories = reposRaw.map((repo) => ({
        fullName: repo?.repo,
        installationId: repo?.installationId,
      }));
      return { connected: repositories.length > 0, installations, repositories };
    },
  };
}
