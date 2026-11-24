import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRemoteSolveLangHttpServer } from "../src/remote.js";
import { TeamStore, TEAM_INVITE_PREFIX, TEAM_TOKEN_PREFIX, normalizeTeamEmail } from "../src/team.js";
import type { Server as HttpServer } from "node:http";

const MASTER = "solvelang_team_master_token_0123456789abcdef";
const INDEX_A = { schema: "solvelang.context.index.v1", marker: "team-alpha-index", records: 3 };
const INDEX_B = { schema: "solvelang.context.index.v1", marker: "team-beta-index", records: 7 };

const REMOTE_TOOL_NAMES = [
  "solvelang_analyze_n8n",
  "solvelang_generate_n8n_report",
  "solvelang_graph_find_nodes",
  "solvelang_graph_search_nodes",
  "solvelang_graph_dependencies",
  "solvelang_graph_dependents",
  "solvelang_graph_shortest_path",
  "solvelang_graph_impact",
  "solvelang_graph_explain_impact",
  "solvelang_capabilities",
] as const;

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

async function api(baseUrl: string, method: string, path: string, token: string | undefined, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
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

async function listToolNames(baseUrl: string, token: string): Promise<string[]> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "team-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    return listed.tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

async function mcpStatus(baseUrl: string, token: string): Promise<number> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "team-test", version: "1.0.0" } } }),
  });
  return response.status;
}

test("team store: email validation and hashed token storage", async () => {
  assert.equal(normalizeTeamEmail("  Owner@Example.COM "), "owner@example.com");
  assert.throws(() => normalizeTeamEmail("not-an-email"), /valid account email/);
  const store = new TeamStore();
  const created = await store.createTeam({ name: "Alpha", ownerEmail: "owner@example.com", contextIndex: INDEX_A });
  assert.ok(created.ownerToken.startsWith(TEAM_TOKEN_PREFIX));
  const serialized = JSON.stringify(created.team);
  assert.ok(!serialized.includes(created.ownerToken), "plaintext owner token must never be stored");
  const auth = await store.authenticate(created.ownerToken);
  assert.equal(auth?.member.role, "owner");
  assert.equal(auth?.team.id, created.team.id);
  assert.equal(await store.authenticate("slteam_0000000000000000000000000000000000000000000000000000000000000000"), undefined);
});

test("team HTTP flow: create, invite by email, accept, shared index, revoke kills access", async () => {
  const server = createRemoteSolveLangHttpServer({ bearerToken: MASTER, teamStore: new TeamStore(), rateLimit: { limit: 1000, windowMs: 60_000 } });
  const baseUrl = await listen(server);
  try {
    // Single-user master creates the team and becomes its owner.
    const created = await api(baseUrl, "POST", "/teams", MASTER, { name: "Alpha", ownerEmail: "owner@example.com", contextIndex: INDEX_A });
    assert.equal(created.status, 201);
    const teamId = created.json.team.id as string;
    const ownerToken = created.json.ownerToken as string;
    assert.ok(ownerToken.startsWith(TEAM_TOKEN_PREFIX));

    // Unauthenticated and non-owner member creation are refused.
    assert.equal((await api(baseUrl, "POST", "/teams", undefined, { name: "X", ownerEmail: "x@example.com" })).status, 401);
    assert.equal((await api(baseUrl, "POST", "/teams", ownerToken, { name: "X", ownerEmail: "x@example.com" })).status, 401);

    // Owner invites a member BY ACCOUNT EMAIL.
    const invite = await api(baseUrl, "POST", `/teams/${teamId}/invites`, ownerToken, { email: "member@example.com" });
    assert.equal(invite.status, 201);
    const inviteToken = invite.json.inviteToken as string;
    assert.ok(inviteToken.startsWith(TEAM_INVITE_PREFIX));

    // Wrong email cannot accept; the invited email can, exactly once.
    assert.equal((await api(baseUrl, "POST", "/teams/accept", undefined, { inviteToken, email: "other@example.com" })).status, 403);
    const accepted = await api(baseUrl, "POST", "/teams/accept", undefined, { inviteToken, email: "member@example.com" });
    assert.equal(accepted.status, 200);
    const memberToken = accepted.json.memberToken as string;
    assert.ok(memberToken.startsWith(TEAM_TOKEN_PREFIX));
    assert.equal((await api(baseUrl, "POST", "/teams/accept", undefined, { inviteToken, email: "member@example.com" })).status, 401);

    // Member list shows owner + member, no token material beyond prefixes.
    const members = await api(baseUrl, "GET", `/teams/${teamId}/members`, memberToken);
    assert.equal(members.status, 200);
    assert.deepEqual(members.json.members.map((m: any) => `${m.email}:${m.role}:${m.status}`), [
      "owner@example.com:owner:active",
      "member@example.com:member:active",
    ]);
    assert.ok(!JSON.stringify(members.json).includes(memberToken));

    // Member token lists the SAME 10 tools and reads the shared index.
    assert.deepEqual(await listToolNames(baseUrl, memberToken), [...REMOTE_TOOL_NAMES]);
    assert.deepEqual(await listToolNames(baseUrl, ownerToken), [...REMOTE_TOOL_NAMES]);
    assert.deepEqual(await listToolNames(baseUrl, MASTER), [...REMOTE_TOOL_NAMES]);
    const indexRead = await api(baseUrl, "GET", `/teams/${teamId}/context-index`, memberToken);
    assert.equal(indexRead.status, 200);
    assert.deepEqual(indexRead.json.contextIndex, INDEX_A);

    // Isolation: the single-user master token is refused the team scope,
    // and a stranger team token is refused this team's index (both ways).
    assert.equal((await api(baseUrl, "GET", `/teams/${teamId}/context-index`, MASTER)).status, 403);
    const other = await api(baseUrl, "POST", "/teams", MASTER, { name: "Beta", ownerEmail: "beta@example.com", contextIndex: INDEX_B });
    const otherTeamId = other.json.team.id as string;
    const otherOwnerToken = other.json.ownerToken as string;
    assert.equal((await api(baseUrl, "GET", `/teams/${teamId}/context-index`, otherOwnerToken)).status, 403);
    assert.equal((await api(baseUrl, "GET", `/teams/${otherTeamId}/context-index`, memberToken)).status, 403);
    const otherRead = await api(baseUrl, "GET", `/teams/${otherTeamId}/context-index`, otherOwnerToken);
    assert.deepEqual(otherRead.json.contextIndex, INDEX_B);

    // Revoke: the member's MCP access and team-index access die at once;
    // owner and single-user access are unaffected.
    const revoked = await api(baseUrl, "POST", `/teams/${teamId}/revoke`, ownerToken, { email: "member@example.com" });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.json.member.status, "revoked");
    assert.equal(await mcpStatus(baseUrl, memberToken), 401);
    assert.equal((await api(baseUrl, "GET", `/teams/${teamId}/context-index`, memberToken)).status, 403);
    assert.equal(await mcpStatus(baseUrl, ownerToken), 200);
    assert.equal(await mcpStatus(baseUrl, MASTER), 200);
    assert.equal((await api(baseUrl, "GET", `/teams/${otherTeamId}/context-index`, otherOwnerToken)).status, 200);

    // The owner cannot be revoked.
    assert.equal((await api(baseUrl, "POST", `/teams/${teamId}/revoke`, ownerToken, { email: "owner@example.com" })).status, 403);
  } finally {
    await close(server);
  }
});

test("team routes fail closed when the team store is unset, /mcp unchanged", async () => {
  const server = createRemoteSolveLangHttpServer({ bearerToken: MASTER, rateLimit: { limit: 1000, windowMs: 60_000 } });
  const baseUrl = await listen(server);
  try {
    assert.equal((await api(baseUrl, "POST", "/teams", MASTER, { name: "Alpha", ownerEmail: "owner@example.com" })).status, 503);
    assert.equal((await api(baseUrl, "GET", "/teams/anything/members", MASTER)).status, 503);
    assert.equal(await mcpStatus(baseUrl, MASTER), 200);
    assert.deepEqual(await listToolNames(baseUrl, MASTER), [...REMOTE_TOOL_NAMES]);
  } finally {
    await close(server);
  }
});
