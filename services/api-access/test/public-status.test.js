import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { createPublicStatusCollector, refreshPublicStatus, sanitizedPublicStatus, STATUS_VALID_FOR_MS } from "../src/public-status.js";
import { createDynamoPublicStatusStore } from "../src/public-status-store.js";

const origin = "https://www.solve-lang.com";
const apiHealth = "https://a123.execute-api.us-east-2.amazonaws.com/health";
const markers = new Map([
  ["/", "See exactly what Solve can do"],
  ["/studio/", "Workflow Intelligence Studio"],
  ["/run/", "Browser preview"],
  ["/repository-audit/", "Repository Audit"],
  ["/solve-graph/", "Solve Graph"],
]);
const at = Date.parse("2026-09-27T12:00:00Z");

function publicFetch(seen = [], failure = false) {
  return async (url, options) => {
    seen.push([String(url), options]);
    if (failure) throw new Error("private upstream failure");
    const path = new URL(url).pathname;
    if (path === "/health") return new Response(JSON.stringify({ status: "ok", service: "solvelang-api-access", privateToken: "secret-never-returned" }), { headers: { "content-type": "application/json" } });
    return new Response(`<html>${markers.get(path)} secret-never-returned</html>`, { headers: { "content-type": "text/html" } });
  };
}

function fakeDynamo() {
  const items = new Map();
  const calls = [];
  return {
    items, calls,
    async send(command) {
      const { input } = command;
      calls.push([command.constructor.name, input]);
      const key = input.Key?.snapshotKey ?? input.Item?.snapshotKey;
      const existing = items.get(key);
      if (command.constructor.name === "GetCommand") return { Item: existing };
      if (command.constructor.name === "UpdateCommand") {
        assert.equal(input.ConditionExpression, "attribute_not_exists(nextEligibleAt) OR nextEligibleAt <= :now");
        if (existing?.nextEligibleAt > input.ExpressionAttributeValues[":now"]) throw Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
        items.set(key, { snapshotKey: key, nextEligibleAt: input.ExpressionAttributeValues[":next"] });
        return {};
      }
      if (command.constructor.name === "PutCommand") {
        assert.equal(input.ConditionExpression, "attribute_not_exists(collectedAt) OR collectedAt < :collectedAt");
        if (existing?.collectedAt >= input.Item.collectedAt) throw Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
        items.set(key, structuredClone(input.Item));
        return {};
      }
      throw new Error("Unexpected DynamoDB command");
    },
  };
}

function apiHandler(reader) {
  return createApiAccessHandler({ service: {}, adminSecret: "a".repeat(64), siteOrigin: origin, enabled: false, publicStatusReader: reader, logger: { error() {} } });
}
const publicRequest = { rawPath: "/public/status/health", headers: { cookie: "private-session" }, requestContext: { http: { method: "GET" } } };

test("scheduled collection probes only six fixed public GET surfaces with bounded observations", async () => {
  const seen = [];
  const collect = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: publicFetch(seen), now: () => at });
  const snapshot = await collect(at);
  assert.equal(seen.length, 6);
  assert.deepEqual(new Set(seen.map(([url]) => url)), new Set([...markers.keys()].map((path) => `${origin}${path}`).concat(apiHealth)));
  for (const [, options] of seen) {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.headers.cookie, undefined);
  }
  assert.equal(Object.keys(snapshot.observations).length, 6);
  for (const observation of Object.values(snapshot.observations)) {
    assert.equal(observation.state, "operational");
    assert.equal(observation.validForMs, STATUS_VALID_FOR_MS);
  }
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|cookie|token|https:\/\//i);
});

test("multiple and concurrent public requests across handler instances read one shared snapshot without fan-out", async () => {
  let now = at;
  const dynamo = fakeDynamo();
  const store = createDynamoPublicStatusStore(dynamo, "public-status", { now: () => now });
  const seen = [];
  const collect = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: publicFetch(seen), now: () => now });
  assert.deepEqual(await refreshPublicStatus({ store, collect, now: () => now }), { refreshed: true });
  assert.equal(seen.length, 6);
  const first = apiHandler(() => store.readSnapshot());
  const second = apiHandler(() => store.readSnapshot());
  const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second)(publicRequest)));
  assert.ok(responses.every((response) => response.statusCode === 200 && JSON.parse(response.body).observations.website.state === "operational"));
  assert.equal(seen.length, 6, "public requests do not collect upstream observations");
  assert.equal(dynamo.calls.filter(([name]) => name === "GetCommand").length, 20);
  assert.equal(dynamo.calls.filter(([name]) => name === "PutCommand").length, 1);
  assert.doesNotMatch(JSON.stringify(dynamo.items.get("current")), /secret|private-session|https:\/\//i);
  assert.doesNotMatch(responses[0].body, /secret|private-session|https:\/\//i);
  assert.equal(responses[0].headers["cache-control"], "no-store");
  now += 30_000;
  assert.equal((await store.readSnapshot()).observations.website.state, "operational");
});

test("conditional shared lease limits concurrent scheduled refreshes to one six-probe sweep per interval", async () => {
  let now = at;
  const dynamo = fakeDynamo();
  const store = createDynamoPublicStatusStore(dynamo, "public-status", { now: () => now });
  const seen = [];
  const collect = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: publicFetch(seen), now: () => now });
  const results = await Promise.all(Array.from({ length: 10 }, () => refreshPublicStatus({ store, collect, now: () => now })));
  assert.equal(results.filter(({ refreshed }) => refreshed).length, 1);
  assert.equal(seen.length, 6);
  assert.deepEqual(await refreshPublicStatus({ store, collect, now: () => now + 54_999 }), { refreshed: false });
  assert.equal(seen.length, 6);
  now += 60_000;
  assert.deepEqual(await refreshPublicStatus({ store, collect, now: () => now }), { refreshed: true });
  assert.equal(seen.length, 12);
});

test("SAM wiring schedules one collector and limits request Lambda to shared snapshot reads", () => {
  const template = readFileSync(new URL("../template.yaml", import.meta.url), "utf8");
  assert.match(template, /PublicStatusTable:[\s\S]*?snapshotKey[\s\S]*?PublicStatusCollectorFunction:/);
  const collector = template.split("  PublicStatusCollectorFunction:")[1].split("  ApiKeyAuthorizerFunction:")[0];
  assert.match(collector, /Schedule: rate\(1 minute\)/);
  assert.match(collector, /dynamodb:UpdateItem[\s\S]*dynamodb:PutItem/);
  assert.doesNotMatch(collector, /DynamoDBCrudPolicy|dynamodb:GetItem|customer|stripe|secret/i);
  const request = template.split("  ApiAccessFunction:")[1].split("  PublicStatusCollectorFunction:")[0];
  assert.match(request, /PUBLIC_STATUS_TABLE: !Ref PublicStatusTable/);
  assert.match(request, /dynamodb:GetItem[\s\S]*Resource: !GetAtt PublicStatusTable\.Arn/);
  assert.doesNotMatch(request, /dynamodb:PutItem[\s\S]*PublicStatusTable\.Arn/);
});

test("missing, stale, future, and corrupt shared snapshots fail closed without request-path refresh", async () => {
  let now = at;
  const dynamo = fakeDynamo();
  const store = createDynamoPublicStatusStore(dynamo, "public-status", { now: () => now });
  const handler = apiHandler(() => store.readSnapshot());
  assert.deepEqual(JSON.parse((await handler(publicRequest)).body), { observations: {} });
  const collect = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: publicFetch(), now: () => now });
  await refreshPublicStatus({ store, collect, now: () => now });
  now += STATUS_VALID_FOR_MS;
  assert.deepEqual(JSON.parse((await handler(publicRequest)).body), { observations: {} });
  assert.deepEqual(sanitizedPublicStatus(dynamo.items.get("current"), at - 1), { observations: {} });
  dynamo.items.set("current", { snapshotKey: "current", collectedAt: new Date(now).toISOString(), observations: { website: { state: "operational" } } });
  assert.deepEqual(JSON.parse((await handler(publicRequest)).body), { observations: {} });
  assert.equal(dynamo.calls.filter(([name]) => name === "PutCommand").length, 1, "reads never refresh");
});

test("failed scheduled refresh never preserves expired green; errors and private fields remain out of public data", async () => {
  let now = at;
  const dynamo = fakeDynamo();
  const store = createDynamoPublicStatusStore(dynamo, "public-status", { now: () => now });
  await refreshPublicStatus({ store, collect: createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: publicFetch(), now: () => now }), now: () => now });
  now += 60_000;
  const failed = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: publicFetch([], true), now: () => now });
  await refreshPublicStatus({ store, collect: failed, now: () => now });
  assert.ok(Object.values((await store.readSnapshot()).observations).every(({ state }) => state === "not_monitored"));
  now += 90_000;
  assert.deepEqual(await store.readSnapshot(), { observations: {} });
  const handler = apiHandler(async () => { throw new Error("private DynamoDB failure"); });
  assert.deepEqual(JSON.parse((await handler(publicRequest)).body), { observations: {} });
  assert.doesNotMatch(JSON.stringify(dynamo.items.get("current")), /private|secret|https:\/\//i);
});

test("collector validates its fixed public origins and bounded timeout", () => {
  assert.throws(() => createPublicStatusCollector({ siteOrigin: "http://internal.example", apiHealthUrl: apiHealth }), /HTTPS origin/);
  assert.throws(() => createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: "https://internal.example/health" }), /invalid/);
  assert.throws(() => createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, timeoutMs: 3_000 }), /timeout/);
});

test("unresponsive public probes time out and produce only unverified observations", async () => {
  const collect = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: async () => new Promise(() => {}), now: () => at, timeoutMs: 10 });
  const snapshot = await collect(at);
  assert.ok(Object.values(snapshot.observations).every(({ state }) => state === "not_monitored"));
});
