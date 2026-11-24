import assert from "node:assert/strict";
import test from "node:test";

import {
  TEAM_CONTEXT_CHECKOUT_PATH,
  TEAM_CONTEXT_PER_SEAT_CENTS,
  TEAM_CONTEXT_PRICE_LINE,
  TEAM_CONTEXT_TEAMS_PATH,
  formatMoney,
  formatSeatPrice,
  parseTeamContextTeams,
  seatLabel,
} from "./team-context";

test("team context pins: the owner-decided seat price and the service paths", () => {
  // Nov 24, 2026: $8 per seat per month, set by the owner. The price
  // line the page prints is built from the same fact.
  assert.equal(TEAM_CONTEXT_PER_SEAT_CENTS, 800);
  assert.equal(TEAM_CONTEXT_PRICE_LINE, "$8 per seat per month");
  assert.equal(TEAM_CONTEXT_TEAMS_PATH, "/customer/team-context/teams");
  assert.equal(TEAM_CONTEXT_CHECKOUT_PATH, "/customer/subscriptions/team-context/elements-checkout");
});

test("parseTeamContextTeams renders the service's seat facts verbatim", () => {
  const parsed = parseTeamContextTeams({
    product: "team-context-index",
    plan: "team-seat-monthly",
    perSeatAmountCents: 800,
    currency: "usd",
    teams: [
      { id: "team_1", name: "Core", activeSeats: 3, monthlyTotalCents: 2400 },
      { id: "team_2", name: "Solo", activeSeats: 1, monthlyTotalCents: 800 },
    ],
  });
  assert.equal(parsed.perSeatAmountCents, 800);
  assert.equal(parsed.currency, "usd");
  assert.deepEqual(parsed.teams, [
    { id: "team_1", name: "Core", activeSeats: 3, monthlyTotalCents: 2400 },
    { id: "team_2", name: "Solo", activeSeats: 1, monthlyTotalCents: 800 },
  ]);
});

test("parseTeamContextTeams derives a missing total from seats x price and drops malformed teams", () => {
  const parsed = parseTeamContextTeams({
    perSeatAmountCents: 800,
    teams: [
      { id: "team_1", name: "Core", activeSeats: 4 },
      { id: "", name: "No id", activeSeats: 2 },
      { name: "Missing id", activeSeats: 2 },
      "not-a-team",
      { id: "team_3", activeSeats: 2.9, monthlyTotalCents: "lots" },
    ],
  });
  assert.deepEqual(parsed.teams, [
    { id: "team_1", name: "Core", activeSeats: 4, monthlyTotalCents: 3200 },
    { id: "team_3", name: "", activeSeats: 2, monthlyTotalCents: 1600 },
  ]);
});

test("parseTeamContextTeams falls back to the pinned price and an empty list, never invented teams", () => {
  for (const payload of [undefined, null, {}, { teams: "nope" }, []]) {
    const parsed = parseTeamContextTeams(payload);
    assert.equal(parsed.perSeatAmountCents, TEAM_CONTEXT_PER_SEAT_CENTS);
    assert.equal(parsed.currency, "usd");
    assert.deepEqual(parsed.teams, []);
  }
});

test("money and seat formatting match the account surfaces' style", () => {
  assert.equal(formatMoney(800), "$8.00");
  assert.equal(formatMoney(2400), "$24.00");
  assert.equal(formatSeatPrice(800), "$8");
  assert.equal(formatSeatPrice(850), "$8.50");
  assert.equal(seatLabel(1), "1 active seat");
  assert.equal(seatLabel(3), "3 active seats");
});
