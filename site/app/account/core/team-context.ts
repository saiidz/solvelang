// Team Context Index billing (Nov 24, 2026) — the account page's
// contract with the API access service, in the same pure-shaping
// style as the other account core modules: no fetch, no window, so
// the QA suite can pin the shapes directly.
//
// The service answers GET /customer/team-context/teams (session
// cookie, like every /customer/* read) with:
//   { product: "team-context-index", plan: "team-seat-monthly",
//     perSeatAmountCents: 800, currency: "usd",
//     teams: [ { id, name, activeSeats, monthlyTotalCents } ] }
// for the teams the signed-in account OWNS on the hosted MCP service.
// Seat semantics are the service's: active members only, the owner
// counts as a seat, revoked members never count, and a
// revoked-then-reinvited member counts once. The page renders those
// numbers verbatim and never recounts anything itself.
//
// The seat price is the owner's decision of Nov 24, 2026: $8 per seat
// per month. It is pinned here as the display fallback for a payload
// that omits it; the service remains the authority when it answers.

export const TEAM_CONTEXT_TEAMS_PATH = "/customer/team-context/teams";
export const TEAM_CONTEXT_CHECKOUT_PATH = "/customer/subscriptions/team-context/elements-checkout";

export const TEAM_CONTEXT_PER_SEAT_CENTS = 800;
export const TEAM_CONTEXT_PRICE_LINE = "$8 per seat per month";

export const TEAM_CONTEXT_EYEBROW = "Team Context Index";
export const TEAM_CONTEXT_TITLE = "Team Context Index billing";
export const TEAM_CONTEXT_INTRO =
  "Your teams on the hosted SolveLang MCP service share one context index. Team billing is per seat: $8 per seat per month, counting active members only — the team owner counts as a seat, and revoked members are never billed.";
export const TEAM_CONTEXT_SYNC_LINE =
  "When a member joins or is removed, the seat count on your subscription updates to match, and the difference is prorated on your next invoice.";
export const TEAM_CONTEXT_EMPTY_LINE =
  "No teams yet. Teams you own on the hosted MCP service appear here with their seat counts.";
export const TEAM_CONTEXT_UNAVAILABLE_LINE =
  "Team billing is not available yet. Your teams keep working exactly as they do today.";

export type TeamContextTeam = {
  id: string;
  name: string;
  activeSeats: number;
  monthlyTotalCents: number;
};

export type TeamContextTeams = {
  perSeatAmountCents: number;
  currency: string;
  teams: TeamContextTeam[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

// Normalize whatever the service answered into the shape the page
// renders. Anything unrecognized becomes an empty team list with the
// pinned price facts — the page's empty state — never invented teams.
export function parseTeamContextTeams(payload: unknown): TeamContextTeams {
  const record = isRecord(payload) ? payload : {};
  const perSeatAmountCents = numberOr(record.perSeatAmountCents, TEAM_CONTEXT_PER_SEAT_CENTS);
  const teams: TeamContextTeam[] = [];
  if (Array.isArray(record.teams)) {
    for (const entry of record.teams) {
      if (!isRecord(entry)) continue;
      if (typeof entry.id !== "string" || entry.id === "") continue;
      const activeSeats = Math.max(0, Math.floor(numberOr(entry.activeSeats, 0)));
      teams.push({
        id: entry.id,
        name: stringOr(entry.name, ""),
        activeSeats,
        monthlyTotalCents: numberOr(entry.monthlyTotalCents, activeSeats * perSeatAmountCents),
      });
    }
  }
  return {
    perSeatAmountCents,
    currency: stringOr(record.currency, "usd"),
    teams,
  };
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Whole-dollar amounts render without cents ("$8"), matching the
// price style of the other account surfaces.
export function formatSeatPrice(perSeatAmountCents: number): string {
  return perSeatAmountCents % 100 === 0 ? `$${perSeatAmountCents / 100}` : formatMoney(perSeatAmountCents);
}

export function seatLabel(activeSeats: number): string {
  return `${activeSeats} active seat${activeSeats === 1 ? "" : "s"}`;
}
