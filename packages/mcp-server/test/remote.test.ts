import assert from "node:assert/strict";
import test from "node:test";
import {
  createRemoteSolveLangHttpServer,
  normalizeRemoteBearerToken,
  remoteBearerHeaderMatches,
} from "../src/remote.js";

const TOKEN = "solvelang_remote_test_token_0123456789abcdef";

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const server = createRemoteSolveLangHttpServer({ bearerToken: TOKEN });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("remote bearer token validation is bounded and constant-time compatible", () => {
  assert.equal(normalizeRemoteBearerToken(`  ${TOKEN}  `), TOKEN);
  assert.throws(() => normalizeRemoteBearerToken("short"), /32-1024/);
  assert.throws(() => normalizeRemoteBearerToken(`${TOKEN} with-space`), /whitespace/);
  assert.equal(remoteBearerHeaderMatches(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(remoteBearerHeaderMatches(`Bearer ${TOKEN}x`, TOKEN), false);
  assert.equal(remoteBearerHeaderMatches("Basic abc", TOKEN), false);
  assert.equal(remoteBearerHeaderMatches(undefined, TOKEN), false);
});

test("remote HTTP boundary exposes only health and authenticated POST MCP ingress", async () => {
  await withServer(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", service: "solvelang-mcp", mode: "remote-read-only" });
    assert.equal(health.headers.get("cache-control"), "no-store");

    const missing = await fetch(`${baseUrl}/missing`);
    assert.equal(missing.status, 404);

    const wrongMethod = await fetch(`${baseUrl}/mcp`);
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "POST");

    const unauthorized = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

    const wrongToken = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer wrong_wrong_wrong_wrong_wrong_wrong", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(wrongToken.status, 401);

    const wrongType = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" },
      body: "{}",
    });
    assert.equal(wrongType.status, 415);

    const badJson = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "not-json",
    });
    assert.equal(badJson.status, 400);
  });
});

test("remote HTTP boundary rejects oversized requests before MCP parsing", async () => {
  await withServer(async (baseUrl) => {
    const oversized = "x".repeat(4 * 1024 * 1024 + 1);
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: oversized,
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  });
});
