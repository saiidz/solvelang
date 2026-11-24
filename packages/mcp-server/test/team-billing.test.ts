import assert from "node:assert/strict";
import test from "node:test";
import type { Server as HttpServer } from "node:http";

import { createRemoteSolveLangHttpServer } from "../src/remote.js";
import { TeamStore, countActiveSeats } from "../src/team.js";
import type { TeamMemberRecord } from "../src/team.js";
import { createTeamBillingSync } from "../src/team-billing.js";
import type { TeamBillingSync } from "../src/team-billing.js";

const MASTER_TOKEN = "aa".repeat(32);
const TEST_TOKEN = "bb".repeat(32);
const BILLING_TOKEN = "cc".repeat(32);

function member(email: string, status: "active" | "revoked"): TeamMemberRecord {
  return { email, role: "member", status, tokenHash: "h", tokenPrefix: "p", createdAt: "2026-01-01T00:00:00.000Z" };
}

test("countActiveSeats counts distinct active emails only", () => {
  assert.equal(countActiveSeats([]), 0);
  assert.equal(countActiveSeats([member("owner@example.com", "active")]), 1);
  // A revoked record never counts, and a revoked-then-reinvited
  // member (two records, one of each status) counts exactly once.
  assert.equal(countActiveSeats([
    member("owner@example.com", "active"),
    member("gone@example.com", "revoked"),
    member("back@example.com", "revoked"),
    member("back@example.com", "active"),
  ]), 2);
});

test("store lifecycle: revoke after re-invite revokes the active record", async () => {
  const store = new TeamStore({});
  const { team } = await store.createTeam({ name: "Core", ownerEmail: "owner@example.com" });
  assert.equal(countActiveSeats(team.members), 1);

  const invite1 = await store.createInvite(team.id, "member@example.com");
  await store.acceptInvite(invite1.inviteToken, "member@example.com");
  assert.equal(countActiveSeats(team.members), 2);

  await store.revokeMember(team.id, "member@example.com");
  assert.equal(countActiveSeats(team.members), 1);

  const invite2 = await store.createInvite(team.id, "member@example.com");
  await store.acceptInvite(invite2.inviteToken, "member@example.com");
  assert.equal(team.members.filter((entry) => entry.email === "member@example.com").length, 2);
  assert.equal(countActiveSeats(team.members), 2);

  // The second revoke must act on the ACTIVE record, not fail on the
  // old revoked one.
  const revoked = await store.revokeMember(team.id, "member@example.com");
  assert.equal(revoked.status, "revoked");
  assert.equal(countActiveSeats(team.members), 1);

  // With only revoked records left, a further revoke is the original
  // already-revoked conflict, and the owner can never be revoked.
  await assert.rejects(() => store.revokeMember(team.id, "member@example.com"), /already been revoked/);
  await assert.rejects(() => store.revokeMember(team.id, "owner@example.com"), /owner cannot be revoked/);
  await assert.rejects(() => store.revokeMember(team.id, "nobody@example.com"), /not a member/);
});

test("listTeamsByOwner returns only the owner's teams", async () => {
  const store = new TeamStore({});
  const first = await store.createTeam({ name: "One", ownerEmail: "owner@example.com" });
  await store.createTeam({ name: "Two", ownerEmail: "other@example.com" });
  const owned = await store.listTeamsByOwner("Owner@Example.com");
  assert.deepEqual(owned.map((team) => team.id), [first.team.id]);
});

async function listen(server: HttpServer): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve) => { server.close(() => resolve()); });
}

async function call(baseUrl: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => undefined);
  return { status: response.status, body };
}

function recordingSync(): TeamBillingSync & { calls: { teamId: string; activeSeats: number }[] } {
  const calls: { teamId: string; activeSeats: number }[] = [];
  return {
    calls,
    enabled: true,
    async notifySeatsChanged(team, members) {
      calls.push({ teamId: team.id, activeSeats: countActiveSeats(members) });
    },
  };
}

test("billing routes serve seat reads to the billing token only", async () => {
  const store = new TeamStore({});
  const { team } = await store.createTeam({ name: "Core", ownerEmail: "owner@example.com" });
  const invite = await store.createInvite(team.id, "member@example.com");
  await store.acceptInvite(invite.inviteToken, "member@example.com");

  const server = createRemoteSolveLangHttpServer({
    bearerToken: MASTER_TOKEN, testToken: TEST_TOKEN, billingToken: BILLING_TOKEN, teamStore: store, rateLimit: false,
  });
  const baseUrl = await listen(server);
  try {
    // The master token, the test token, and no token are all refused:
    // billing reads belong to the billing token alone.
    assert.equal((await call(baseUrl, "/billing/teams?ownerEmail=owner@example.com", { headers: { authorization: `Bearer ${MASTER_TOKEN}` } })).status, 401);
    assert.equal((await call(baseUrl, "/billing/teams?ownerEmail=owner@example.com", { headers: { authorization: `Bearer ${TEST_TOKEN}` } })).status, 401);
    assert.equal((await call(baseUrl, "/billing/teams?ownerEmail=owner@example.com")).status, 401);

    const list = await call(baseUrl, "/billing/teams?ownerEmail=owner@example.com", { headers: { authorization: `Bearer ${BILLING_TOKEN}` } });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, { teams: [{ id: team.id, name: "Core", activeSeats: 2 }] });

    const detail = await call(baseUrl, `/billing/teams/${team.id}`, { headers: { authorization: `Bearer ${BILLING_TOKEN}` } });
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body, { id: team.id, name: "Core", ownerEmail: "owner@example.com", activeSeats: 2 });

    assert.equal((await call(baseUrl, "/billing/teams/nope", { headers: { authorization: `Bearer ${BILLING_TOKEN}` } })).status, 404);
    assert.equal((await call(baseUrl, "/billing/teams", { headers: { authorization: `Bearer ${BILLING_TOKEN}` } })).status, 400);
    assert.equal((await call(baseUrl, "/billing/teams?ownerEmail=owner@example.com", { method: "POST", headers: { authorization: `Bearer ${BILLING_TOKEN}` } })).status, 405);
  } finally {
    await close(server);
  }

  // Without a billing token the routes are dark, even for the
  // billing-shaped request.
  const dark = createRemoteSolveLangHttpServer({ bearerToken: MASTER_TOKEN, teamStore: store, rateLimit: false });
  const darkUrl = await listen(dark);
  try {
    const res = await call(darkUrl, "/billing/teams?ownerEmail=owner@example.com", { headers: { authorization: `Bearer ${BILLING_TOKEN}` } });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "billing_unavailable");
  } finally {
    await close(dark);
  }
});

test("membership changes notify the seat sync with the new active count", async () => {
  const store = new TeamStore({});
  const sync = recordingSync();
  const server = createRemoteSolveLangHttpServer({
    bearerToken: MASTER_TOKEN, billingToken: BILLING_TOKEN, teamBillingSync: sync, teamStore: store, rateLimit: false,
  });
  const baseUrl = await listen(server);
  const json = { "content-type": "application/json" };
  try {
    const created = await call(baseUrl, "/teams", {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${MASTER_TOKEN}` },
      body: JSON.stringify({ name: "Core", ownerEmail: "owner@example.com" }),
    });
    assert.equal(created.status, 201);
    const teamId = created.body.team.id as string;
    const ownerToken = created.body.ownerToken as string;
    assert.deepEqual(sync.calls, []);

    const invite = await call(baseUrl, `/teams/${teamId}/invites`, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ email: "member@example.com" }),
    });
    assert.equal(invite.status, 201);
    // Invites alone do not change the seat count.
    assert.deepEqual(sync.calls, []);

    const accepted = await call(baseUrl, "/teams/accept", {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ inviteToken: invite.body.inviteToken, email: "member@example.com" }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(sync.calls, [{ teamId, activeSeats: 2 }]);

    const revoked = await call(baseUrl, `/teams/${teamId}/revoke`, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ email: "member@example.com" }),
    });
    assert.equal(revoked.status, 200);
    assert.deepEqual(sync.calls, [{ teamId, activeSeats: 2 }, { teamId, activeSeats: 1 }]);

    // The DELETE member path syncs too.
    const invite2 = await call(baseUrl, `/teams/${teamId}/invites`, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ email: "member@example.com" }),
    });
    await call(baseUrl, "/teams/accept", {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ inviteToken: invite2.body.inviteToken, email: "member@example.com" }),
    });
    const deleted = await call(baseUrl, `/teams/${teamId}/members/member%40example.com`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual(sync.calls.at(-1), { teamId, activeSeats: 1 });
  } finally {
    await close(server);
  }
});

test("the sync client posts the count with the shared secret and never throws", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const okFetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const sync = createTeamBillingSync({
    url: "https://api.solve-lang.com/team-context/seat-sync",
    secret: "sync-secret",
    fetchImpl: okFetch,
    logger: { warn() {} },
  });
  assert.equal(sync.enabled, true);
  const store = new TeamStore({});
  const { team } = await store.createTeam({ name: "Core", ownerEmail: "owner@example.com" });
  await sync.notifySeatsChanged(team, team.members);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.solve-lang.com/team-context/seat-sync");
  assert.equal((seen[0].init.headers as Record<string, string>)["x-team-context-sync-secret"], "sync-secret");
  assert.deepEqual(JSON.parse(seen[0].init.body as string), { teamId: team.id, activeSeats: 1 });

  // Failures - network errors and HTTP errors alike - are swallowed.
  const failing = createTeamBillingSync({
    url: "https://api.solve-lang.com/team-context/seat-sync",
    secret: "sync-secret",
    fetchImpl: (async () => { throw new Error("network down"); }) as typeof fetch,
    logger: { warn() {} },
  });
  await failing.notifySeatsChanged(team, team.members);
  const httpFailing = createTeamBillingSync({
    url: "https://api.solve-lang.com/team-context/seat-sync",
    secret: "sync-secret",
    fetchImpl: (async () => new Response("no", { status: 500 })) as typeof fetch,
    logger: { warn() {} },
  });
  await httpFailing.notifySeatsChanged(team, team.members);

  // Missing either pointer disables the client: no calls at all.
  let calls = 0;
  const dark = createTeamBillingSync({
    url: "https://api.solve-lang.com/team-context/seat-sync",
    fetchImpl: (async () => { calls += 1; return new Response("{}", { status: 200 }); }) as typeof fetch,
    logger: { warn() {} },
  });
  assert.equal(dark.enabled, false);
  await dark.notifySeatsChanged(team, team.members);
  assert.equal(calls, 0);
});
