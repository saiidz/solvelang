import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBusMessage } from "../src/bus-envelope.js";
import {
  createRelayHttpServer,
  normalizeRelayConfig,
  relayTokenSha256,
  startRelayServer,
  type RelayConfig,
} from "../src/relay.js";

const TOKEN_A = "relay-test-token-agent-a-0000000001";
const TOKEN_B = "relay-test-token-agent-b-0000000002";
const TOKEN_C = "relay-test-token-agent-c-0000000003";

function testConfig(): RelayConfig {
  return normalizeRelayConfig({
    workspaces: [
      {
        id: "ws-one",
        requireSignatures: false,
        tokens: [
          { agent: "agent-a", tokenSha256: relayTokenSha256(TOKEN_A) },
          { agent: "agent-b", tokenSha256: relayTokenSha256(TOKEN_B) },
        ],
      },
      {
        id: "ws-two",
        requireSignatures: false,
        tokens: [{ agent: "agent-c", tokenSha256: relayTokenSha256(TOKEN_C) }],
      },
    ],
  });
}

async function boot(config: RelayConfig, options: { rateLimit?: { limit: number; windowMs: number } } = {}): Promise<{ server: HttpServer; base: string }> {
  const server = createRelayHttpServer({ config, rateLimit: options.rateLimit });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function call(base: string, token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: any; headers: Headers }> {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json, headers: response.headers };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("health is open, everything else requires a bound bearer token", async (t) => {
  const { server, base } = await boot(testConfig());
  t.after(() => server.close());

  const health = await fetch(base + "/healthz");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, "solvelang-relay");

  assert.equal((await call(base, null, "GET", "/relay/claims")).status, 401);
  assert.equal((await call(base, "not-a-real-token", "GET", "/relay/claims")).status, 401);
  assert.equal((await call(base, TOKEN_A, "GET", "/nope")).status, 404);
  assert.equal((await call(base, TOKEN_A, "DELETE", "/relay/claims")).status, 405);
});

test("messages deliver to the addressed agent and to broadcast, never across workspaces", async (t) => {
  const { server, base } = await boot(testConfig());
  t.after(() => server.close());

  const direct = createBusMessage({ fromAgent: "agent-a", toAgent: "agent-b", kind: "signal", body: { signal: "done", task: "x" } });
  const posted = await call(base, TOKEN_A, "POST", "/relay/messages", direct);
  assert.equal(posted.status, 200);
  assert.equal(posted.json.ok, true);

  const broadcast = createBusMessage({ fromAgent: "agent-a", toAgent: "*", kind: "signal", body: { signal: "free" } });
  assert.equal((await call(base, TOKEN_A, "POST", "/relay/messages", broadcast)).status, 200);

  const forB = await call(base, TOKEN_B, "GET", "/relay/messages?since=0");
  assert.deepEqual(forB.json.messages.map((m: any) => m.id), [direct.id, broadcast.id]);

  const forA = await call(base, TOKEN_A, "GET", "/relay/messages?since=0");
  assert.deepEqual(forA.json.messages.map((m: any) => m.id), [broadcast.id]);

  const forC = await call(base, TOKEN_C, "GET", "/relay/messages?since=0");
  assert.deepEqual(forC.json.messages, []);
});

test("duplicate posts collapse by content-hash id; forged ids and senders are refused", async (t) => {
  const { server, base } = await boot(testConfig());
  t.after(() => server.close());

  const envelope = createBusMessage({ fromAgent: "agent-a", toAgent: "agent-b", kind: "propose", body: { split: 1 } });
  assert.equal((await call(base, TOKEN_A, "POST", "/relay/messages", envelope)).status, 200);
  const again = await call(base, TOKEN_A, "POST", "/relay/messages", envelope);
  assert.equal(again.status, 200);
  assert.equal(again.json.duplicate, true);
  const forB = await call(base, TOKEN_B, "GET", "/relay/messages?since=0");
  assert.equal(forB.json.messages.length, 1);

  const forged = { ...envelope, body: { split: 2 } };
  const forgedResult = await call(base, TOKEN_A, "POST", "/relay/messages", forged);
  assert.equal(forgedResult.status, 400);
  assert.equal(forgedResult.json.error, "bus_id_mismatch");

  const malformed = { ...envelope, schema: "solvelang.bus.message.v999" };
  const malformedResult = await call(base, TOKEN_A, "POST", "/relay/messages", malformed);
  assert.equal(malformedResult.status, 400);
  assert.equal(malformedResult.json.error, "bus_malformed");

  const impersonated = createBusMessage({ fromAgent: "agent-b", toAgent: "agent-a", kind: "signal" });
  const impersonatedResult = await call(base, TOKEN_A, "POST", "/relay/messages", impersonated);
  assert.equal(impersonatedResult.status, 403);
  assert.equal(impersonatedResult.json.error, "bus_sender_mismatch");
});

test("claims are atomic at claim time, leased, and released only by the holder", async (t) => {
  const { server, base } = await boot(testConfig());
  t.after(() => server.close());

  const first = await call(base, TOKEN_A, "POST", "/relay/claims", { item: "src/top.ts", ttlMs: 60_000 });
  assert.equal(first.json.granted, true);

  const competing = await call(base, TOKEN_B, "POST", "/relay/claims", { item: "src/top.ts", ttlMs: 60_000 });
  assert.equal(competing.json.granted, false);
  assert.equal(competing.json.holder, "agent-a");

  const foreignRelease = await call(base, TOKEN_B, "POST", "/relay/claims/release", { item: "src/top.ts" });
  assert.equal(foreignRelease.json.released, false);

  const release = await call(base, TOKEN_A, "POST", "/relay/claims/release", { item: "src/top.ts" });
  assert.equal(release.json.released, true);

  const releasedSignal = await call(base, TOKEN_B, "GET", "/relay/messages?since=0");
  assert.ok(releasedSignal.json.messages.some((m: any) => m.body?.signal === "claim_released" && m.body?.item === "src/top.ts"));

  const after = await call(base, TOKEN_B, "POST", "/relay/claims", { item: "src/top.ts", ttlMs: 60_000 });
  assert.equal(after.json.granted, true);

  // Workspace isolation: the same item is unclaimed in ws-two.
  const isolated = await call(base, TOKEN_C, "POST", "/relay/claims", { item: "src/top.ts", ttlMs: 60_000 });
  assert.equal(isolated.json.granted, true);
  const wsOneClaims = await call(base, TOKEN_A, "GET", "/relay/claims");
  assert.deepEqual(wsOneClaims.json.claims.map((c: any) => c.holder), ["agent-b"]);
});

test("an expired lease frees the item and is signalled", async (t) => {
  const { server, base } = await boot(testConfig());
  t.after(() => server.close());

  const claim = await call(base, TOKEN_A, "POST", "/relay/claims", { item: "src/mid.ts", ttlMs: 250 });
  assert.equal(claim.json.granted, true);
  await sleep(450);
  const after = await call(base, TOKEN_B, "POST", "/relay/claims", { item: "src/mid.ts", ttlMs: 60_000 });
  assert.equal(after.json.granted, true);
  const signals = await call(base, TOKEN_B, "GET", "/relay/messages?since=0");
  assert.ok(signals.json.messages.some((m: any) => m.body?.signal === "claim_expired" && m.body?.item === "src/mid.ts"));
});

test("presence reports last-seen from authenticated traffic", async (t) => {
  const { server, base } = await boot(testConfig());
  t.after(() => server.close());

  await call(base, TOKEN_A, "POST", "/relay/presence");
  const seen = await call(base, TOKEN_B, "GET", "/relay/presence?agent=agent-a");
  assert.equal(typeof seen.json.lastSeen, "number");
  assert.ok(seen.json.silentMs >= 0 && seen.json.silentMs < 5_000);
  const unseen = await call(base, TOKEN_B, "GET", "/relay/presence?agent=agent-c");
  assert.equal(unseen.json.lastSeen, null);
});

test("long-poll wakes early when a message lands", async (t) => {
  const { server, base } = await boot(testConfig());
  t.after(() => server.close());

  const envelope = createBusMessage({ fromAgent: "agent-a", toAgent: "agent-b", kind: "signal", body: { signal: "blocked" } });
  const started = Date.now();
  const poll = call(base, TOKEN_B, "GET", "/relay/messages?since=0&waitMs=10000");
  await sleep(150);
  await call(base, TOKEN_A, "POST", "/relay/messages", envelope);
  const result = await poll;
  assert.ok(Date.now() - started < 5_000, "poll returned promptly after the message landed");
  assert.deepEqual(result.json.messages.map((m: any) => m.id), [envelope.id]);
});

test("claim state recovers from the audit log across a restart; messages do not replay", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-recovery-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const auditLogPath = join(dir, "audit.jsonl");
  const config = testConfig();

  const first = await startRelayServer({ config, auditLogPath, port: 0, host: "127.0.0.1" });
  const firstAddress = first.address();
  assert.ok(firstAddress && typeof firstAddress === "object");
  const base1 = `http://127.0.0.1:${firstAddress.port}`;
  const claim = await call(base1, TOKEN_A, "POST", "/relay/claims", { item: "src/top.ts", ttlMs: 60_000 });
  assert.equal(claim.json.granted, true);
  await new Promise<void>((resolve) => first.close(() => resolve()));
  await sleep(50);

  const second = await startRelayServer({ config, auditLogPath, port: 0, host: "127.0.0.1" });
  t.after(() => second.close());
  const secondAddress = second.address();
  assert.ok(secondAddress && typeof secondAddress === "object");
  const base2 = `http://127.0.0.1:${secondAddress.port}`;
  const competing = await call(base2, TOKEN_B, "POST", "/relay/claims", { item: "src/top.ts", ttlMs: 60_000 });
  assert.equal(competing.json.granted, false);
  assert.equal(competing.json.holder, "agent-a");
  const presence = await call(base2, TOKEN_B, "GET", "/relay/presence?agent=agent-a");
  assert.equal(typeof presence.json.lastSeen, "number");
});

test("the rate limiter answers 429 with Retry-After, and oversize bodies 413", async (t) => {
  const { server, base } = await boot(testConfig(), { rateLimit: { limit: 3, windowMs: 60_000 } });
  t.after(() => server.close());

  for (let i = 0; i < 3; i += 1) {
    assert.equal((await call(base, TOKEN_A, "GET", "/relay/claims")).status, 200);
  }
  const limited = await call(base, TOKEN_A, "GET", "/relay/claims");
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error, "rate_limited");
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);

  const { server: server2, base: base2 } = await boot(testConfig());
  t.after(() => server2.close());
  const oversize = await fetch(base2 + "/relay/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_A}`, "Content-Type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(300 * 1024) }),
  });
  assert.equal(oversize.status, 413);
});
