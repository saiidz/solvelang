import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRemoteSolveLangHttpServer } from "../src/remote.js";
import { TeamStore } from "../src/team.js";
import type { Server as HttpServer } from "node:http";

const MASTER = "solvelang_team_qa_master_token_0123456789abcdef";
const TESTT = "solvelang_team_qa_test_token_0123456789abcdef00";

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
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function api(baseUrl: string, method: string, route: string, token: string | undefined, body?: unknown) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => undefined);
  return { status: response.status, json: json as Record<string, any> };
}

async function callCapabilities(baseUrl: string, token: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "solvelang_capabilities", arguments: {} } }),
  });
  assert.equal(response.status, 200);
  const json = (await response.json()) as Record<string, any>;
  return json.result;
}

async function makeTeam(baseUrl: string, ownerEmail: string, marker: string) {
  const created = await api(baseUrl, "POST", "/teams", MASTER, {
    name: `Team ${marker}`,
    ownerEmail,
    contextIndex: { schema: "solvelang.context.index.v1", marker },
  });
  assert.equal(created.status, 201);
  return { teamId: created.json.team.id as string, ownerToken: created.json.ownerToken as string };
}

async function inviteAndAccept(baseUrl: string, teamId: string, ownerToken: string, email: string): Promise<string> {
  const invite = await api(baseUrl, "POST", `/teams/${teamId}/invites`, ownerToken, { email });
  assert.equal(invite.status, 201);
  const accepted = await api(baseUrl, "POST", "/teams/accept", undefined, { inviteToken: invite.json.inviteToken, email });
  assert.equal(accepted.status, 200);
  return accepted.json.memberToken as string;
}

test("QA pin: file-backed team store persists across restarts and stores no plaintext tokens", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "solvelang-team-qa-"));
  const filePath = path.join(dir, "teams.json");
  const store1 = new TeamStore({ filePath });
  await store1.load();
  const server1 = createRemoteSolveLangHttpServer({ bearerToken: MASTER, teamStore: store1, rateLimit: { limit: 1000, windowMs: 60_000 } });
  const base1 = await listen(server1);
  let ownerToken = "";
  let teamId = "";
  try {
    const made = await makeTeam(base1, "persist-owner@example.com", "persisted-index");
    ownerToken = made.ownerToken;
    teamId = made.teamId;
  } finally {
    await close(server1);
  }
  const onDisk = await readFile(filePath, "utf8");
  assert.ok(!onDisk.includes(ownerToken), "team store file must never contain a plaintext token");
  assert.ok(onDisk.includes("persist-owner@example.com"));

  const store2 = new TeamStore({ filePath });
  await store2.load();
  const server2 = createRemoteSolveLangHttpServer({ bearerToken: MASTER, teamStore: store2, rateLimit: { limit: 1000, windowMs: 60_000 } });
  const base2 = await listen(server2);
  try {
    const read = await api(base2, "GET", `/teams/${teamId}/context-index`, ownerToken);
    assert.equal(read.status, 200);
    assert.equal(read.json.contextIndex.marker, "persisted-index");
  } finally {
    await close(server2);
  }
});

test("QA pin: owner-only index update, DELETE member route, duplicate invite conflict", async () => {
  const server = createRemoteSolveLangHttpServer({ bearerToken: MASTER, testToken: TESTT, teamStore: new TeamStore(), rateLimit: { limit: 1000, windowMs: 60_000 } });
  const baseUrl = await listen(server);
  try {
    const { teamId, ownerToken } = await makeTeam(baseUrl, "qa-owner@example.com", "v1");
    const memberToken = await inviteAndAccept(baseUrl, teamId, ownerToken, "qa-member@example.com");

    // Duplicate invite of an active member conflicts.
    assert.equal((await api(baseUrl, "POST", `/teams/${teamId}/invites`, ownerToken, { email: "qa-member@example.com" })).status, 409);

    // A plain member cannot replace the shared index; the owner can, and
    // the member immediately reads the replacement.
    assert.equal((await api(baseUrl, "PUT", `/teams/${teamId}/context-index`, memberToken, { contextIndex: { schema: "solvelang.context.index.v1", marker: "v2" } })).status, 403);
    const put = await api(baseUrl, "PUT", `/teams/${teamId}/context-index`, ownerToken, { contextIndex: { schema: "solvelang.context.index.v1", marker: "v2" } });
    assert.equal(put.status, 200);
    const read = await api(baseUrl, "GET", `/teams/${teamId}/context-index`, memberToken);
    assert.equal(read.json.contextIndex.marker, "v2");

    // Capabilities are byte-identical for member, owner, master, test tokens.
    const capsMember = await callCapabilities(baseUrl, memberToken);
    const capsMaster = await callCapabilities(baseUrl, MASTER);
    const capsTest = await callCapabilities(baseUrl, TESTT);
    assert.deepEqual(capsMember, capsMaster);
    assert.deepEqual(capsTest, capsMaster);

    // DELETE /teams/:id/members/:email revokes exactly like the POST route.
    const deleted = await api(baseUrl, "DELETE", `/teams/${teamId}/members/${encodeURIComponent("qa-member@example.com")}`, ownerToken);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.json.member.status, "revoked");
    assert.equal((await api(baseUrl, "GET", `/teams/${teamId}/context-index`, memberToken)).status, 403);
    const members = await api(baseUrl, "GET", `/teams/${teamId}/members`, ownerToken);
    assert.deepEqual(members.json.members.map((m: any) => m.status), ["active", "revoked"]);
  } finally {
    await close(server);
  }
});

test("QA pin: team routes are rate-limited before authentication", async () => {
  const server = createRemoteSolveLangHttpServer({ bearerToken: MASTER, teamStore: new TeamStore(), rateLimit: { limit: 3, windowMs: 60_000 } });
  const baseUrl = await listen(server);
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const attempt = await api(baseUrl, "POST", "/teams", undefined, { name: "X", ownerEmail: "x@example.com" });
      statuses.push(attempt.status);
    }
    assert.deepEqual(statuses.slice(0, 3), [401, 401, 401]);
    assert.ok(statuses.slice(3).every((status) => status === 429), `expected 429 after the limit, got ${statuses.join(",")}`);
  } finally {
    await close(server);
  }
});
