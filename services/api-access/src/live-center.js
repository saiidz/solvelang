import { ApiAccessError } from "./service.js";

// Live Center board proxy core. The customer-facing route in
// api-handler.js is session-gated; this service owns only the upstream
// call to the Merge Governance pilot's board endpoint. The pilot is the
// system of record for queue state — the board JSON passes through
// unchanged so the site renders exactly what governance computed.
//
// Fail-closed discipline (mirrors the optional STRIPE_MGOV_* config): the
// service is enabled only when every pilot pointer is configured. When it
// is not, getBoard() throws 503 mgov_not_configured and no upstream call
// is ever attempted. Any upstream transport failure, non-2xx status, or
// unparseable body maps to 502 upstream_unavailable — the caller never
// sees pilot internals.
export function createLiveCenterService({ config, fetchImpl = fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const enabled = Boolean(config?.enabled);
  return {
    async getBoard() {
      if (!enabled) {
        throw new ApiAccessError(503, "mgov_not_configured", "Live Center is not configured.");
      }
      const baseUrl = String(config.baseUrl).replace(/\/+$/, "");
      const query = new URLSearchParams({
        owner: config.owner,
        repo: config.repo,
        installationId: config.installationId,
      });
      const url = `${baseUrl}/tenants/${encodeURIComponent(config.tenant)}/board?${query.toString()}`;
      let upstream;
      try {
        upstream = await fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json", "x-admin-token": config.adminToken },
        });
      } catch {
        throw new ApiAccessError(502, "upstream_unavailable", "Live Center is temporarily unavailable.");
      }
      if (!upstream || upstream.ok !== true) {
        throw new ApiAccessError(502, "upstream_unavailable", "Live Center is temporarily unavailable.");
      }
      try {
        return await upstream.json();
      } catch {
        throw new ApiAccessError(502, "upstream_unavailable", "Live Center is temporarily unavailable.");
      }
    },
  };
}
