import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminIngress } from "../src/index.js";

const env = {
  ADMIN_ORIGIN: "https://admin.solve-lang.com",
  ADMIN_GATEWAY_UPSTREAM: "https://ru2uokfkge.execute-api.us-east-2.amazonaws.com/admin-gateway",
};

function withAssets(fetchAsset) {
  return {
    ...env,
    ASSETS: {
      fetch: fetchAsset,
    },
  };
}

test("non-gateway paths stay unpublished when the assets binding is absent", async () => {
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

test("publication root serves the reviewed index asset with hardened headers", async () => {
  let seen;
  const publishedEnv = withAssets(async (assetRequest) => {
    seen = assetRequest;
    return new Response("<!doctype html><title>SolveLang Admin</title>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });

  const response = await handleAdminIngress(
    new Request("https://admin.solve-lang.com/", {
      headers: {
        cookie: "CF_Authorization=access-token; __Host-solvelang-admin=session-token",
        "cf-access-jwt-assertion": "access-jwt",
      },
    }),
    publishedEnv,
    async () => {
      throw new Error("static requests must not reach the gateway");
    },
  );

  assert.equal(seen.url, "https://admin.solve-lang.com/index.html");
  assert.equal(seen.headers.get("cookie"), null);
  assert.equal(seen.headers.get("cf-access-jwt-assertion"), null);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-cache");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
});

test("only the reviewed static file allowlist can reach the assets binding", async () => {
  let assetCalls = 0;
  const response = await handleAdminIngress(
    new Request("https://admin.solve-lang.com/build-release.mjs"),
    withAssets(async () => {
      assetCalls += 1;
      return new Response("unexpected", { status: 200 });
    }),
  );
  assert.equal(response.status, 404);
  assert.equal(assetCalls, 0);
  assert.equal((await response.json()).code, "not_found");
});

test("static publication allows only GET and HEAD", async () => {
  let assetCalls = 0;
  const response = await handleAdminIngress(
    new Request("https://admin.solve-lang.com/", { method: "POST" }),
    withAssets(async () => {
      assetCalls += 1;
      return new Response("unexpected", { status: 200 });
    }),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  assert.equal(assetCalls, 0);
});

test("a missing reviewed asset fails closed", async () => {
  const response = await handleAdminIngress(
    new Request("https://admin.solve-lang.com/styles.css"),
    withAssets(async () => new Response("missing", { status: 404 })),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "admin_static_unavailable");
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

test("gateway paths take precedence over static assets", async () => {
  let assetCalls = 0;
  let gatewayCalls = 0;
  const response = await handleAdminIngress(
    new Request("https://admin.solve-lang.com/admin-gateway/session"),
    withAssets(async () => {
      assetCalls += 1;
      return new Response("unexpected asset", { status: 200 });
    }),
    async () => {
      gatewayCalls += 1;
      return new Response("{}", { status: 401 });
    },
  );
  assert.equal(response.status, 401);
  assert.equal(assetCalls, 0);
  assert.equal(gatewayCalls, 1);
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

test("prefix confusion does not reach the gateway or static assets", async () => {
  let gatewayCalled = false;
  let assetCalled = false;
  const response = await handleAdminIngress(
    new Request("https://admin.solve-lang.com/admin-gateway-evil/session"),
    withAssets(async () => {
      assetCalled = true;
      throw new Error("must not fetch asset");
    }),
    async () => {
      gatewayCalled = true;
      throw new Error("must not proxy");
    },
  );
  assert.equal(response.status, 404);
  assert.equal(gatewayCalled, false);
  assert.equal(assetCalled, false);
});
