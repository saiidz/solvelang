import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminIngress } from "../src/index.js";

const env = {
  ADMIN_ORIGIN: "https://admin.solve-lang.com",
  ADMIN_GATEWAY_UPSTREAM: "https://ru2uokfkge.execute-api.us-east-2.amazonaws.com/admin-gateway",
};

test("non-gateway paths stay unpublished", async () => {
  let called = false;
  const response = await handleAdminIngress(
    new Request("https://admin.solve-lang.com/"),
    env,
    async () => {
      called = true;
      throw new Error("must not proxy");
    },
  );
  assert.equal(response.status, 404);
  assert.equal(called, false);
  assert.deepEqual(await response.json(), {
    error: "Admin UI is not published.",
    code: "admin_static_not_published",
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("gateway requests proxy to the exact reviewed upstream path", async () => {
  let seen;
  const request = new Request(
    "https://admin.solve-lang.com/admin-gateway/session?probe=1",
    {
      headers: {
        origin: "https://admin.solve-lang.com",
        cookie: "CF_Authorization=access-token; __Host-solvelang-admin=session-token",
        "cf-access-jwt-assertion": "access-jwt",
        "x-test": "preserved",
      },
    },
  );

  const response = await handleAdminIngress(request, env, async (upstreamRequest) => {
    seen = upstreamRequest;
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "set-cookie": "__Host-solvelang-admin=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
      },
    });
  });

  assert.equal(seen.url, "https://ru2uokfkge.execute-api.us-east-2.amazonaws.com/admin-gateway/session?probe=1");
  assert.equal(seen.headers.get("origin"), "https://admin.solve-lang.com");
  assert.equal(seen.headers.get("cf-access-jwt-assertion"), null);
  assert.equal(seen.headers.get("cookie"), "__Host-solvelang-admin=session-token");
  assert.equal(seen.headers.get("x-test"), "preserved");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.match(response.headers.get("set-cookie") || "", /__Host-solvelang-admin=/);
});

test("same-origin GETs without an Origin header are normalized server-side", async () => {
  let seenOrigin;
  const response = await handleAdminIngress(
    new Request("https://admin.solve-lang.com/admin-gateway/session"),
    env,
    async (upstreamRequest) => {
      seenOrigin = upstreamRequest.headers.get("origin");
      return new Response("{}", { status: 401 });
    },
  );
  assert.equal(seenOrigin, "https://admin.solve-lang.com");
  assert.equal(response.status, 401);
});

test("foreign browser origins are denied before proxying", async () => {
  let called = false;
  const response = await handleAdminIngress(
    new Request("https://admin.solve-lang.com/admin-gateway/session", {
      headers: { origin: "https://evil.example" },
    }),
    env,
    async () => {
      called = true;
      throw new Error("must not proxy");
    },
  );
  assert.equal(response.status, 403);
  assert.equal(called, false);
  assert.equal((await response.json()).code, "origin_denied");
});

test("prefix confusion does not reach the gateway", async () => {
  let called = false;
  const response = await handleAdminIngress(
    new Request("https://admin.solve-lang.com/admin-gateway-evil/session"),
    env,
    async () => {
      called = true;
      throw new Error("must not proxy");
    },
  );
  assert.equal(response.status, 404);
  assert.equal(called, false);
});
