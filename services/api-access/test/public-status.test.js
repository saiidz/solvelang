import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { createPublicStatusCollector, refreshPublicStatus, sanitizedPublicStatus, STATUS_VALID_FOR_MS } from "../src/public-status.js";
import { createDynamoPublicStatusStore } from "../src/public-status-store.js";

const origin = "https://www.solve-lang.com";
const apiHealth = "https://a123.execute-api.us-east-2.amazonaws.com/health";
const executionHealth = "https://e123.execute-api.us-east-2.amazonaws.com/health";
const runnerMinutesHealth = "https://runner-minutes.example.com/health";
const posthogStatusUrl = "https://www.posthogstatus.com/api/status";
const markers = new Map([
  ["/", "See exactly what Solve can do"],
  ["/studio/", "Workflow Intelligence Studio"],
  ["/run/", "Browser preview"],
  ["/repository-audit/", "Repository Audit"],
  ["/solve-graph/", "Solve Graph"],
  ["/support/", "SolveLang help"],
]);
const at = Date.parse("2026-09-27T12:00:00Z");

function publicFetch(seen = [], failure = false, posthogOverall = "operational") {
  return async (url, options) => {
    seen.push([String(url), options]);
    if (failure) throw new Error("private upstream failure");
    const target = new URL(url);
    const path = target.pathname;
    if (target.hostname === "www.posthogstatus.com") return new Response(JSON.stringify({ overall_status: posthogOverall, generated_at: "2026-09-27T12:00:00.000Z" }), { headers: { "content-type": "application/json" } });
    if (target.hostname === "e123.execute-api.us-east-2.amazonaws.com") return new Response(JSON.stringify({ status: "ok", service: "solvelang-merge-governance" }), { headers: { "content-type": "application/json" } });
    if (target.hostname === "runner-minutes.example.com") return new Response(JSON.stringify({ status: "ok", service: "solvelang-runners" }), { headers: { "content-type": "application/json" } });
    if (target.hostname === "github.com") return new Response("<svg>passing</svg>", { headers: { "content-type": "image/svg+xml" } });
    if (path === "/health" || path === "/public/status/account" || path === "/public/status/billing") return new Response(JSON.stringify({ status: "ok", service: "solvelang-api-access", privateToken: "secret-never-returned" }), { headers: { "content-type": "application/json" } });
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

test("scheduled collection probes only thirteen fixed public GET surfaces with bounded observations", async () => {
  const seen = [];
  const collect = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, executionHealthUrl: executionHealth, runnerMinutesHealthUrl: runnerMinutesHealth, fetchImpl: publicFetch(seen), now: () => at });
  const snapshot = await collect(at);
  assert.equal(seen.length, 13);
  assert.deepEqual(new Set(seen.map(([url]) => url)), new Set([...markers.keys()].map((path) => `${origin}${path}`).concat(apiHealth, apiHealth.replace(/\/health$/, "/public/status/account"), apiHealth.replace(/\/health$/, "/public/status/billing"), "https://github.com/saiidz/solvelang/actions/workflows/ci.yml/badge.svg", executionHealth, runnerMinutesHealth, posthogStatusUrl)));
  for (const [, options] of seen) {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.headers.cookie, undefined);
  }
  assert.equal(Object.keys(snapshot.observations).length, 13);
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
  assert.equal(seen.length, 11);
  const first = apiHandler(() => store.readSnapshot());
  const second = apiHandler(() => store.readSnapshot());
  const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second)(publicRequest)));
  assert.ok(responses.every((response) => response.statusCode === 200 && JSON.parse(response.body).observations.website.state === "operational"));
  assert.equal(seen.length, 11, "public requests do not collect upstream observations");
  assert.equal(dynamo.calls.filter(([name]) => name === "GetCommand").length, 20);
  assert.equal(dynamo.calls.filter(([name]) => name === "PutCommand").length, 1);
  assert.doesNotMatch(JSON.stringify(dynamo.items.get("current")), /secret|private-session|https:\/\//i);
  assert.doesNotMatch(responses[0].body, /secret|private-session|https:\/\//i);
  assert.equal(responses[0].headers["cache-control"], "no-store");
  now += 30_000;
  assert.equal((await store.readSnapshot()).observations.website.state, "operational");
});

test("conditional shared lease limits concurrent scheduled refreshes to one ten-probe sweep per interval", async () => {
  let now = at;
  const dynamo = fakeDynamo();
  const store = createDynamoPublicStatusStore(dynamo, "public-status", { now: () => now });
  const seen = [];
  const collect = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: publicFetch(seen), now: () => now });
  const results = await Promise.all(Array.from({ length: 10 }, () => refreshPublicStatus({ store, collect, now: () => now })));
  assert.equal(results.filter(({ refreshed }) => refreshed).length, 1);
  assert.equal(seen.length, 11);
  assert.deepEqual(await refreshPublicStatus({ store, collect, now: () => now + 54_999 }), { refreshed: false });
  assert.equal(seen.length, 11);
  now += 60_000;
  assert.deepEqual(await refreshPublicStatus({ store, collect, now: () => now }), { refreshed: true });
  assert.equal(seen.length, 22);
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


test("status probe routes answer ok only when the underlying probe passes", async () => {
  const base = { service: {}, adminSecret: "a".repeat(64), siteOrigin: origin, enabled: false, logger: { error() {} } };
  const accountRequest = { rawPath: "/public/status/account", headers: {}, requestContext: { http: { method: "GET" } } };
  const billingRequest = { rawPath: "/public/status/billing", headers: {}, requestContext: { http: { method: "GET" } } };
  const okHandler = createApiAccessHandler({ ...base, statusProbes: { accountPersistence: async () => true, billing: async () => true } });
  assert.equal((await okHandler(accountRequest)).statusCode, 200);
  assert.equal(JSON.parse((await okHandler(billingRequest)).body).status, "ok");
  const failing = createApiAccessHandler({ ...base, statusProbes: { accountPersistence: async () => false, billing: async () => { throw new Error("down"); } } });
  assert.equal((await failing(accountRequest)).statusCode, 503);
  assert.equal((await failing(billingRequest)).statusCode, 503);
  const unconfigured = createApiAccessHandler({ ...base });
  assert.equal((await unconfigured(accountRequest)).statusCode, 503);
  assert.equal((await unconfigured(billingRequest)).statusCode, 503);
});

test("sanitizer fails closed when a newly wired component is missing", async () => {
  const collect = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: publicFetch([]), now: () => at });
  const snapshot = await collect(at);
  assert.equal(Object.keys(snapshot.observations).length, 13);
  assert.equal(sanitizedPublicStatus(snapshot, at).observations["ci-deployment"].state, "operational");
  assert.equal(sanitizedPublicStatus(snapshot, at).observations.billing.state, "operational");
  assert.equal(sanitizedPublicStatus(snapshot, at).observations.posthog.state, "operational");
  assert.equal(snapshot.observations["provider-execution"].state, "not_monitored", "unconfigured execution probe reports unmonitored but stays present");
  assert.equal(snapshot.observations["runner-minutes"].state, "not_monitored", "unconfigured runner-minutes probe reports unmonitored but stays present");
  const missingExecution = { ...snapshot, observations: { ...snapshot.observations } };
  delete missingExecution.observations["provider-execution"];
  assert.deepEqual(sanitizedPublicStatus(missingExecution, at), { observations: {} });
  const incomplete = { ...snapshot, observations: { ...snapshot.observations } };
  delete incomplete.observations.billing;
  assert.deepEqual(sanitizedPublicStatus(incomplete, at), { observations: {} });
});

test("ci-deployment observation follows the live CI badge, never optimism", async () => {
  const failingBadgeFetch = async (url, options) => {
    if (new URL(url).hostname === "github.com") return new Response("<svg>failing</svg>", { headers: { "content-type": "image/svg+xml" } });
    return publicFetch([])(url, options);
  };
  const collect = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: failingBadgeFetch, now: () => at });
  const snapshot = await collect(at);
  assert.equal(snapshot.observations["ci-deployment"].state, "not_monitored");
  assert.equal(snapshot.observations.website.state, "operational");
});

test("provider-execution follows the managed-execution health probe only when configured", async () => {
  const seen = [];
  const configured = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, executionHealthUrl: executionHealth, fetchImpl: publicFetch(seen), now: () => at });
  const snapshot = await configured(at);
  assert.equal(snapshot.observations["provider-execution"].state, "operational");
  assert.ok(seen.some(([url]) => url === executionHealth));

  const unconfiguredSeen = [];
  const unconfigured = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: publicFetch(unconfiguredSeen), now: () => at });
  const unset = await unconfigured(at);
  assert.equal(unset.observations["provider-execution"].state, "not_monitored");
  assert.equal(unconfiguredSeen.some(([url]) => url === executionHealth), false, "no fetch is attempted while the execution URL is unset");

  const wrongServiceFetch = async (url, options) => {
    if (new URL(url).hostname === "e123.execute-api.us-east-2.amazonaws.com") return new Response(JSON.stringify({ status: "ok", service: "solvelang-api-access" }), { headers: { "content-type": "application/json" } });
    return publicFetch([])(url, options);
  };
  const wrong = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, executionHealthUrl: executionHealth, fetchImpl: wrongServiceFetch, now: () => at });
  assert.equal((await wrong(at)).observations["provider-execution"].state, "not_monitored", "a different service answering is not managed-execution health");

  const downFetch = async (url, options) => {
    if (new URL(url).hostname === "e123.execute-api.us-east-2.amazonaws.com") throw new Error("down");
    return publicFetch([])(url, options);
  };
  const down = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, executionHealthUrl: executionHealth, fetchImpl: downFetch, now: () => at });
  assert.equal((await down(at)).observations["provider-execution"].state, "not_monitored");
});

test("posthog observation maps PostHog's public overall status, never optimism", async () => {
  const mapping = [["operational", "operational"], ["degraded_performance", "degraded"], ["partial_outage", "partial_outage"], ["full_outage", "major_outage"], ["under_maintenance", "maintenance"], ["some_future_value", "not_monitored"]];
  for (const [overall, expected] of mapping) {
    const collect = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: publicFetch([], false, overall), now: () => at });
    assert.equal((await collect(at)).observations.posthog.state, expected, `overall_status ${overall}`);
  }
  const failingPosthogFetch = async (url, options) => {
    if (new URL(url).hostname === "www.posthogstatus.com") throw new Error("down");
    return publicFetch([])(url, options);
  };
  const collect = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: failingPosthogFetch, now: () => at });
  const snapshot = await collect(at);
  assert.equal(snapshot.observations.posthog.state, "not_monitored");
  assert.equal(snapshot.observations.website.state, "operational");
});

test("posthog probe times out into not_monitored without stalling the sweep", async () => {
  const hangingPosthogFetch = async (url, options) => {
    if (new URL(url).hostname === "www.posthogstatus.com") return new Promise(() => {});
    return publicFetch([])(url, options);
  };
  const collect = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: hangingPosthogFetch, now: () => at, timeoutMs: 10 });
  const snapshot = await collect(at);
  assert.equal(snapshot.observations.posthog.state, "not_monitored");
  assert.equal(snapshot.observations.website.state, "operational");
});

test("runner-minutes stays unmonitored until its health URL is configured, then follows the probe", async () => {
  const seen = [];
  const unconfigured = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, fetchImpl: publicFetch(seen), now: () => at });
  const unset = await unconfigured(at);
  assert.equal(unset.observations["runner-minutes"].state, "not_monitored");
  assert.equal(seen.some(([url]) => url === runnerMinutesHealth), false, "no fetch is attempted while the runner-minutes URL is unset");

  const configured = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, runnerMinutesHealthUrl: runnerMinutesHealth, fetchImpl: publicFetch([]), now: () => at });
  assert.equal((await configured(at)).observations["runner-minutes"].state, "operational");

  const wrongServiceFetch = async (url, options) => {
    if (new URL(url).hostname === "runner-minutes.example.com") return new Response(JSON.stringify({ status: "ok", service: "solvelang-api-access" }), { headers: { "content-type": "application/json" } });
    return publicFetch([])(url, options);
  };
  const wrong = createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, runnerMinutesHealthUrl: runnerMinutesHealth, fetchImpl: wrongServiceFetch, now: () => at });
  assert.equal((await wrong(at)).observations["runner-minutes"].state, "not_monitored");
});

test("collector validates the optional health URLs when they are configured", () => {
  assert.throws(() => createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, executionHealthUrl: "http://e123.execute-api.us-east-2.amazonaws.com/health" }), /Public execution health URL is invalid/);
  assert.throws(() => createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, executionHealthUrl: "https://example.com/health" }), /Public execution health URL is invalid/);
  assert.throws(() => createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, runnerMinutesHealthUrl: "https://user:secret@runner-minutes.example.com/health" }), /Public runner-minutes health URL is invalid/);
  assert.throws(() => createPublicStatusCollector({ siteOrigin: origin, apiHealthUrl: apiHealth, runnerMinutesHealthUrl: "https://runner-minutes.example.com/status" }), /Public runner-minutes health URL is invalid/);
});

test("SAM wiring passes the execution and runner-minutes health URLs to the collector only", () => {
  const template = readFileSync(new URL("../template.yaml", import.meta.url), "utf8");
  assert.match(template, /PublicStatusExecutionHealthUrl:\n    Type: String\n    Default: https:\/\/2l346svz17\.execute-api\.us-east-2\.amazonaws\.com\/health/);
  assert.match(template, /PublicStatusRunnerMinutesHealthUrl:\n    Type: String\n    Default: ""/);
  const collector = template.split("  PublicStatusCollectorFunction:")[1].split("  ApiKeyAuthorizerFunction:")[0];
  assert.match(collector, /PUBLIC_STATUS_EXECUTION_HEALTH_URL: !Ref PublicStatusExecutionHealthUrl/);
  assert.match(collector, /PUBLIC_STATUS_RUNNER_MINUTES_HEALTH_URL: !Ref PublicStatusRunnerMinutesHealthUrl/);
  const request = template.split("  ApiAccessFunction:")[1].split("  PublicStatusCollectorFunction:")[0];
  assert.doesNotMatch(request, /PUBLIC_STATUS_EXECUTION_HEALTH_URL|PUBLIC_STATUS_RUNNER_MINUTES_HEALTH_URL/);
});
