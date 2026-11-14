import { ApiAccessError } from "./service.js";

// Live Center proxy core. The customer-facing routes in api-handler.js
// are session-gated; this service owns only the upstream calls — to the
// Merge Governance pilot's board endpoint, and (when it is configured)
// to the runners ledger service behind the Minutes tab. The pilot is
// the system of record for queue state — its board JSON passes through
// unchanged so the site renders exactly what governance computed.
//
// Fail-closed discipline (mirrors the optional STRIPE_MGOV_* config):
// the service is enabled only when every pilot pointer is configured.
// When it is not, both reads throw 503 mgov_not_configured and no
// upstream call is ever attempted. Any upstream transport failure,
// non-2xx status, or unparseable body maps to 502
// upstream_unavailable — the caller never sees upstream internals.
//
// THE MINUTES SEAM: runner minutes live in the separate runners
// service, which is not deployed yet. getMinutes() therefore answers
// { configured: false } until BOTH runners-ledger pointers
// (RUNNERS_LEDGER_BASE_URL / RUNNERS_LEDGER_ADMIN_TOKEN) are set —
// the site renders its honest not-configured state from that answer
// and never invents a balance. When the pointers exist, this proxies
// the ledger's account summary:
//
//   GET {minutesBaseUrl}/accounts/{tenant}/minutes-summary
//   header: x-admin-token: {minutesAdminToken}
//   -> the summary JSON (balances, cache, lanes, byRepository,
//      recentJobs, recommendation — see the site's
//      normalizeLiveCenterMinutes for the exact fields the page
//      reads), which is passed through with `configured: true`
//      stamped on by this proxy.
//
// THE OWNER PANEL SEAM: the same minutes pointers also carry the
// owner control panel. The api-handler routes under
// /customer/runner-minutes-admin/* are gated on the signed-in
// identity (isMinutesOwner below — exactly one account, the owner's
// own); the methods here only run behind that gate and call the
// ledger's admin surface with the same token:
//   GET  {minutesBaseUrl}/admin/accounts
//   POST {minutesBaseUrl}/admin/accounts/{tenant}/{credit|debit|pause|resume}
// The admin token never leaves the server: it is set on the upstream
// call here and never appears in anything returned to the browser.

// The owner panel's gate: exactly one SolveLang account operates the
// runner-minutes ledger — the owner's own. tenantId === accountId
// across this seam (see the runners service's session validator), so
// the account id below is also the owner's ledger tenant. Env
// overrides (RUNNERS_LEDGER_OWNER_ACCOUNT_ID / _EMAIL, parsed in
// config.js) exist for staging; production uses these values.
export const MINUTES_OWNER_ACCOUNT_ID = "acct_b234472a01a209f69aadac7f145c2dbe";
export const MINUTES_OWNER_EMAIL = "saiidzeidan@gmail.com";

function positiveIntParam(value) {
  const num = Number(value);
  return Number.isSafeInteger(num) && num >= 1 ? String(num) : null;
}

export function createLiveCenterService({ config, fetchImpl = fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const enabled = Boolean(config?.enabled);
  const minutesEnabled = Boolean(
    config?.minutesEnabled && config?.minutesBaseUrl && config?.minutesAdminToken,
  );

  async function upstreamJson(url, adminToken, { method = "GET", body } = {}) {
    let upstream;
    try {
      upstream = await fetchImpl(url, {
        method,
        headers: {
          accept: "application/json",
          "x-admin-token": adminToken,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
  }

  return {
    // Board read. Optional pagination params are forwarded to the
    // pilot only when they are clean positive integers — a malformed
    // param is dropped (the pilot then serves the whole payload)
    // rather than passed upstream raw.
    async getBoard(params = {}) {
      if (!enabled) {
        throw new ApiAccessError(503, "mgov_not_configured", "Live Center is not configured.");
      }
      const baseUrl = String(config.baseUrl).replace(/\/+$/, "");
      const query = new URLSearchParams({
        owner: config.owner,
        repo: config.repo,
        installationId: config.installationId,
      });
      const page = positiveIntParam(params?.page);
      const perPage = positiveIntParam(params?.perPage);
      if (page) query.set("page", page);
      if (perPage) query.set("perPage", perPage);
      const url = `${baseUrl}/tenants/${encodeURIComponent(config.tenant)}/board?${query.toString()}`;
      return upstreamJson(url, config.adminToken);
    },

    async getMinutes() {
      if (!enabled) {
        throw new ApiAccessError(503, "mgov_not_configured", "Live Center is not configured.");
      }
      if (!minutesEnabled) {
        return { configured: false };
      }
      const baseUrl = String(config.minutesBaseUrl).replace(/\/+$/, "");
      const url = `${baseUrl}/accounts/${encodeURIComponent(config.tenant)}/minutes-summary`;
      const summary = await upstreamJson(url, config.minutesAdminToken);
      return { ...summary, configured: true };
    },

    // The owner gate for the panel routes: BOTH halves of the
    // identity must match the signed-in session. A session carrying
    // only the email or only the account id is not the owner.
    isMinutesOwner(session) {
      const accountId = config?.minutesOwnerAccountId || MINUTES_OWNER_ACCOUNT_ID;
      const email = String(config?.minutesOwnerEmail || MINUTES_OWNER_EMAIL).toLowerCase();
      return (
        session?.accountId === accountId &&
        typeof session?.email === "string" &&
        session.email.toLowerCase() === email
      );
    },

    async getMinutesAdminAccounts() {
      if (!enabled) {
        throw new ApiAccessError(503, "mgov_not_configured", "Live Center is not configured.");
      }
      if (!minutesEnabled) {
        return { configured: false };
      }
      const baseUrl = String(config.minutesBaseUrl).replace(/\/+$/, "");
      const result = await upstreamJson(`${baseUrl}/admin/accounts`, config.minutesAdminToken);
      return { ...result, configured: true };
    },

    async minutesAdminAction(tenantId, action, body = {}) {
      if (!enabled) {
        throw new ApiAccessError(503, "mgov_not_configured", "Live Center is not configured.");
      }
      if (!minutesEnabled) {
        throw new ApiAccessError(503, "minutes_not_configured", "Runner minutes are not configured.");
      }
      const baseUrl = String(config.minutesBaseUrl).replace(/\/+$/, "");
      const url = `${baseUrl}/admin/accounts/${encodeURIComponent(tenantId)}/${encodeURIComponent(action)}`;
      return upstreamJson(url, config.minutesAdminToken, { method: "POST", body });
    },
  };
}
