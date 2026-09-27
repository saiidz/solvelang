import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { createPublicStatusSource, publicApiHealthUrl } from "../src/public-status.js";

const origin = "https://www.solve-lang.com";
const apiHealth = "https://a123.execute-api.us-east-2.amazonaws.com/health";
const markers = new Map([
  ["/", "See exactly what Solve can do"],
  ["/studio/", "Workflow Intelligence Studio"],
  ["/run/", "Browser preview"],
  ["/repository-audit/", "Repository Audit"],
  ["/solve-graph/", "Solve Graph"],
]);
function publicFetch(seen = []) {
  return async (url, options) => {
    seen.push([String(url), options]);
    const path = new URL(url).pathname;
    if (path === "/health") return new Response(JSON.stringify({ status: "ok", service: "solvelang-api-access", privateToken: "secret-never-returned" }), { headers: { "content-type": "application/json" } });
    return new Response(`<html>${markers.get(path)} secret-never-returned</html>`, { headers: { "content-type": "text/html" } });
  };
}

test("public status checks only six fixed read-only URLs and returns sanitized bounded observations", async () => {
  const seen = [];
  const source = createPublicStatusSource({ siteOrigin: origin, fetchImpl: publicFetch(seen), now: () => Date.parse("2026-09-27T12:00:00Z") });
  const result = await source(apiHealth);
  assert.equal(seen.length, 6);
  assert.deepEqual(new Set(seen.map(([url]) => url)), new Set([...markers.keys()].map((path) => `${origin}${path}`).concat(apiHealth)));
  for (const [, options] of seen) {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.headers.cookie, undefined);
  }
  assert.equal(Object.keys(result.observations).length, 6);
  for (const observation of Object.values(result.observations)) {
    assert.equal(observation.state, "operational");
    assert.equal(observation.checkedAt, "2026-09-27T12:00:00.000Z");
    assert.equal(observation.validForMs, 90_000);
  }
  assert.doesNotMatch(JSON.stringify(result), /secret|cookie|token|https:\/\//i);
  assert.deepEqual(await source(apiHealth), result);
  assert.equal(seen.length, 6, "brief cache avoids duplicate probes");
});

test("failed, invalid, oversized, and timed-out checks fail closed", async () => {
  const failed = createPublicStatusSource({ siteOrigin: origin, fetchImpl: async () => { throw new Error("private failure"); } });
  for (const result of Object.values((await failed(apiHealth)).observations)) assert.equal(result.state, "not_monitored");
  const invalid = createPublicStatusSource({ siteOrigin: origin, fetchImpl: async () => new Response("wrong page", { headers: { "content-type": "text/html" } }) });
  for (const result of Object.values((await invalid(apiHealth)).observations)) assert.equal(result.state, "not_monitored");
  const oversized = createPublicStatusSource({ siteOrigin: origin, fetchImpl: async () => new Response(`See exactly what Solve can do${"x".repeat(140_000)}`, { headers: { "content-type": "text/html" } }) });
  assert.equal((await oversized()).observations.website.state, "not_monitored");
  const timeout = createPublicStatusSource({ siteOrigin: origin, fetchImpl: async () => new Promise(() => {}), timeoutMs: 10 });
  assert.equal((await timeout(apiHealth)).observations.website.state, "not_monitored");
});

test("API health URL comes only from the matching public API Gateway request context", () => {
  const requestContext = { apiId: "a123", domainName: "a123.execute-api.us-east-2.amazonaws.com" };
  assert.equal(publicApiHealthUrl({ requestContext }), apiHealth);
  assert.equal(publicApiHealthUrl({ requestContext: { ...requestContext, domainName: "internal.example" } }), undefined);
  assert.equal(publicApiHealthUrl({ requestContext: { ...requestContext, apiId: "other" } }), undefined);
});

test("public status route works with feature gates off and publishes no private response data", async () => {
  const handler = createApiAccessHandler({
    service: {}, adminSecret: "a".repeat(64), siteOrigin: origin, enabled: false,
    publicStatusFetch: publicFetch(), logger: { error() {} },
  });
  const result = await handler({ rawPath: "/public/status/health", headers: { cookie: "private-session" }, requestContext: { http: { method: "GET" }, apiId: "a123", domainName: "a123.execute-api.us-east-2.amazonaws.com" } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.headers["access-control-allow-origin"], origin);
  assert.equal(JSON.parse(result.body).observations.website.state, "operational");
  assert.doesNotMatch(result.body, /secret|private-session|https:\/\//i);
});
