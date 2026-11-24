import { ApiAccessError } from "./service.js";
import {
  TEAM_CONTEXT_MAX_SEATS,
  TEAM_CONTEXT_MIN_SEATS,
  getTeamContextPlan,
} from "./team-context-plans.js";

// Server-side bridge between the signed-in account world and the
// hosted MCP service's team store. The MCP service owns team records;
// this service only reads seat facts from it (server-to-server, with
// the dedicated billing token) and pushes seat counts into the Stripe
// subscription recorded at checkout time. Constructed only when BOTH
// the MCP base URL and the billing token are configured, mirroring
// the Merge Governance service pointer's both-or-dark discipline.
//
// Seat semantics live here in one place: billing counts ACTIVE
// members only, and the MCP service's billing read already returns
// distinct active-member counts (revoked members persist as records
// but never count, and a revoked-then-reinvited member counts once).
// This service forwards those counts; it never recounts raw records.
export function createTeamContextBillingService({ mcpBaseUrl, mcpBillingToken, gateway, teamContextStore, fetchImpl = fetch, logger = console, now = Date.now }) {
  if (typeof mcpBaseUrl !== "string" || !/^https?:\/\//.test(mcpBaseUrl)) {
    throw new Error("Team context MCP base URL is required.");
  }
  if (typeof mcpBillingToken !== "string" || !mcpBillingToken) {
    throw new Error("Team context MCP billing token is required.");
  }
  if (!gateway || typeof gateway.updateSubscriptionQuantity !== "function") {
    throw new Error("Stripe subscription gateway is required.");
  }
  if (!teamContextStore
    || typeof teamContextStore.getTeamSubscription !== "function"
    || typeof teamContextStore.recordTeamSubscription !== "function") {
    throw new Error("Team context store is required.");
  }
  const base = mcpBaseUrl.replace(/\/+$/, "");

  function cleanTeamId(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]+$/.test(value.trim()) || value.trim().length > 200) {
      throw new ApiAccessError(400, "invalid_team_context", "Team ID is invalid.");
    }
    return value.trim();
  }

  function cleanEmail(value) {
    if (typeof value !== "string") throw new ApiAccessError(400, "invalid_team_context", "Email is invalid.");
    const email = value.trim().toLowerCase();
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiAccessError(400, "invalid_team_context", "Email is invalid.");
    }
    return email;
  }

  function cleanSeatCount(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > TEAM_CONTEXT_MAX_SEATS) {
      throw new ApiAccessError(400, "invalid_team_context", "Active seat count is invalid.");
    }
    return value;
  }

  async function mcpJson(path) {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${mcpBillingToken}` },
      });
    } catch {
      throw new ApiAccessError(502, "team_context_unavailable", "Team data is temporarily unavailable.");
    }
    if (response.status === 404) {
      throw new ApiAccessError(404, "team_not_found", "That team was not found.");
    }
    if (!response.ok) {
      throw new ApiAccessError(502, "team_context_unavailable", "Team data is temporarily unavailable.");
    }
    try {
      return await response.json();
    } catch {
      throw new ApiAccessError(502, "team_context_unavailable", "Team data is temporarily unavailable.");
    }
  }

  function cleanTeamSummary(value) {
    if (!value || typeof value !== "object") {
      throw new ApiAccessError(502, "team_context_unavailable", "Team data is temporarily unavailable.");
    }
    return {
      id: cleanTeamId(value.id),
      name: typeof value.name === "string" ? value.name.slice(0, 200) : "",
      activeSeats: cleanSeatCount(value.activeSeats),
    };
  }

  return {
    // The signed-in account page: the caller's own teams with the
    // price facts the page renders ("$8 per seat per month" plus the
    // monthly total for the current seat count).
    async listOwnerTeams({ email }) {
      const ownerEmail = cleanEmail(email);
      const payload = await mcpJson(`/billing/teams?ownerEmail=${encodeURIComponent(ownerEmail)}`);
      if (!payload || !Array.isArray(payload.teams)) {
        throw new ApiAccessError(502, "team_context_unavailable", "Team data is temporarily unavailable.");
      }
      const plan = getTeamContextPlan("team-seat-monthly");
      return {
        product: "team-context-index",
        plan: plan.name,
        perSeatAmountCents: plan.perSeatAmountCents,
        currency: plan.currency,
        teams: payload.teams.map((team) => {
          const summary = cleanTeamSummary(team);
          return { ...summary, monthlyTotalCents: summary.activeSeats * plan.perSeatAmountCents };
        }),
      };
    },

    // One team's seat facts including its owner, for the checkout
    // route's ownership check: the subscription is opened for the
    // signed-in owner of the team, never for a client-supplied team.
    async getTeamSeats({ teamId }) {
      const id = cleanTeamId(teamId);
      const payload = await mcpJson(`/billing/teams/${encodeURIComponent(id)}`);
      const summary = cleanTeamSummary(payload);
      return { ...summary, ownerEmail: cleanEmail(payload?.ownerEmail) };
    },

    // The seat-sync entry point: the MCP service reports the team's
    // new active-seat count after a membership change and the Stripe
    // subscription quantity follows. The change applies to the
    // subscription immediately; Stripe's prorations settle on the
    // next invoice (the gateway's documented behavior). Teams with
    // no subscription are a normal, successful no-op - subscribing
    // stays the owner's choice, never a lockout.
    async syncTeamSeats({ teamId, activeSeats }) {
      const id = cleanTeamId(teamId);
      const reported = cleanSeatCount(activeSeats);
      // A team always has at least its owner as an active seat, so a
      // reported zero can only be a stale read; the subscription
      // never drops below one seat while it exists.
      const seats = Math.min(Math.max(reported, TEAM_CONTEXT_MIN_SEATS), TEAM_CONTEXT_MAX_SEATS);
      const record = await teamContextStore.getTeamSubscription(id);
      if (!record || typeof record.subscriptionId !== "string" || !record.subscriptionId) {
        return { synced: false, reason: "no_subscription", teamId: id, activeSeats: seats };
      }
      const result = await gateway.updateSubscriptionQuantity({ subscriptionId: record.subscriptionId, quantity: seats });
      if (result.applied) {
        await teamContextStore.recordTeamSubscription({ ...record, seats, updatedAt: now() }).catch(() => {});
      }
      return {
        synced: Boolean(result.applied),
        ...(result.reason ? { reason: result.reason } : {}),
        teamId: id,
        activeSeats: seats,
        subscriptionId: record.subscriptionId,
      };
    },
  };
}
