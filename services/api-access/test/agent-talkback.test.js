import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { API_PLAN_FACTS, HOW_BUYING_WORKS, RUNNER_MINUTES_FACTS } from "../src/agent-facts.js";
import { AGENT_RATE_LIMIT, AGENT_TOOL_NAMES, createAgentTalkback } from "../src/agent-talkback.js";
import { createApiAccessHandler } from "../src/api-handler.js";
import { parseApiAccessEnvironment } from "../src/config.js";

// The agent talk-back doorway is a read-only MCP facts surface. These
// tests pin the whole safety shape: the exact public shelf, three
// parameterless tools, the kill switch, the rate limit, the call log,
// and the code-level separation from account/ledger/Stripe/GitHub code.

function baseEnvironment(overrides = {}) {
  return {
    API_ACCESS_ENABLED: "true",
    API_ACCESS_MODE: "live",
    API_KEY_PEPPER: "k".repeat(64),
    API_ACCESS_ADMIN_SECRET: "a".repeat(64),
    API_ACCOUNTS_TABLE: "accounts",
    API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage",
    API_USAGE_IDEMPOTENCY_TABLE: "idempotency",
    API_SUBSCRIPTION_EVENTS_TABLE: "events",
    API_CUSTOMER_ACCOUNTS_ENABLED: "true",
    API_CUSTOMER_AUTH_TABLE: "auth",
    API_CUSTOMER_AUTH_PEPPER: "c".repeat(64),
    API_CUSTOMER_AUTH_EMAIL_SENDER: "hello@example.com",
    API_CUSTOMER_TOTP_ENABLED: "false",
    API_ADMIN_CRM_ENABLED: "false",
    API_SUBSCRIPTION_BILLING_ENABLED: "false",
    SITE_ORIGIN: "https://www.solve-lang.com",
    ...overrides,
  };
}

function captureLogger() {
  const lines = [];
  return { lines, info(entry) { lines.push(entry); }, error() {} };
}

function rpc(method, params, id = 1) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
}

function call(talkback, bodyText, { method = "POST", source = "203.0.113.8" } = {}) {
  return talkback.handle({ method, bodyText, source });
}

test("facts pin the exact runner-minutes shelf from the services page", () => {
  assert.deepEqual(
    RUNNER_MINUTES_FACTS.standard.packs.map((pack) => [pack.minutes, pack.price]),
    [[5_000, 20], [25_000, 100], [100_000, 400]],
  );
  assert.deepEqual(
    RUNNER_MINUTES_FACTS.highPower.packs.map((pack) => [pack.minutes, pack.price]),
    [[1_000, 80], [2_000, 140], [3_000, 192], [4_000, 236], [5_000, 275], [6_000, 306], [7_000, 336], [8_000, 360], [9_000, 382.5], [10_000, 400]],
  );
  assert.equal(RUNNER_MINUTES_FACTS.standard.pricePerMinute, 0.004);
  assert.equal(RUNNER_MINUTES_FACTS.currency, "USD");
  assert.equal(RUNNER_MINUTES_FACTS.pricesIncludeTax, true);
  assert.equal(RUNNER_MINUTES_FACTS.metering.minimumSecondsPerJob, 10);
  assert.equal(RUNNER_MINUTES_FACTS.metering.spotMultiplier, 1);
  assert.equal(RUNNER_MINUTES_FACTS.metering.onDemandMultiplier, 2);
  assert.equal(RUNNER_MINUTES_FACTS.metering.packsAutoRenew, false);
  assert.equal(RUNNER_MINUTES_FACTS.metering.expiryMonthsAfterPurchase, 12);
  assert.match(RUNNER_MINUTES_FACTS.speedNote, /never free/);
});

test("facts pin the exact API plans from the services page", () => {
  assert.deepEqual(
    API_PLAN_FACTS.plans.map((plan) => [plan.name, plan.pricePerMonth, plan.monthlyCredits, plan.maxActiveKeys]),
    [["developer", 49, 1_000, 2], ["pro", 199, 10_000, 3], ["business", 699, 50_000, 5]],
  );
});

test("buying explanation states the embedded-pages fact and the surface's own limit", () => {
  assert.match(HOW_BUYING_WORKS, /never sent to an external checkout/);
  assert.match(HOW_BUYING_WORKS, /SolveLang GitHub App/);
  assert.match(HOW_BUYING_WORKS, /cannot create an account, start a checkout, or charge anything/);
});

test("facts module imports nothing and the talkback module imports only the facts module", async () => {
  const factsSource = await readFile(new URL("../src/agent-facts.js", import.meta.url), "utf8");
  assert.equal(/^\s*import\s/m.test(factsSource), false, "agent-facts.js must not import anything");
  const talkbackSource = await readFile(new URL("../src/agent-talkback.js", import.meta.url), "utf8");
  const imports = [...talkbackSource.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["./agent-facts.js"]);
  for (const banned of ["stripe", "ledger", "tenant", "account", "github", "dynamo", "store", "credits", "subscriptions", "keys"]) {
    assert.equal(talkbackSource.toLowerCase().includes(`from "./${banned}`), false, `agent-talkback.js must not import ${banned}`);
  }
});

test("config keeps the doorway dark unless the flag is exactly true", () => {
  assert.equal(parseApiAccessEnvironment(baseEnvironment()).agentTalkbackEnabled, false);
  assert.equal(parseApiAccessEnvironment(baseEnvironment({ AGENT_TALKBACK_ENABLED: "true" })).agentTalkbackEnabled, true);
  assert.equal(parseApiAccessEnvironment(baseEnvironment({ AGENT_TALKBACK_ENABLED: "TRUE" })).agentTalkbackEnabled, false);
  assert.equal(parseApiAccessEnvironment(baseEnvironment({ AGENT_TALKBACK_ENABLED: "1" })).agentTalkbackEnabled, false);
});

test("kill switch: a disabled doorway refuses every method and logs the refusal", async () => {
  const logger = captureLogger();
  const talkback = createAgentTalkback({ enabled: false, logger });
  const post = await call(talkback, rpc("tools/call", { name: "get_api_plans" }));
  assert.equal(post.statusCode, 503);
  assert.equal(post.body.error, "agent_talkback_disabled");
  const get = await call(talkback, "", { method: "GET" });
  assert.equal(get.statusCode, 503);
  assert.equal(get.body.error, "agent_talkback_disabled");
  assert.deepEqual(logger.lines.map((line) => line.outcome), ["refused_disabled", "refused_disabled"]);
  assert.equal(logger.lines[0].tool, "get_api_plans");
  assert.equal(logger.lines[0].type, "agent_talkback_call");
});

test("non-POST methods on an enabled doorway are refused 405", async () => {
  const talkback = createAgentTalkback({ enabled: true, logger: captureLogger() });
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    const outcome = await call(talkback, "", { method });
    assert.equal(outcome.statusCode, 405, method);
    assert.equal(outcome.body.error, "method_not_allowed");
  }
});

test("initialize, ping, tools/list and notifications follow the MCP shape", async () => {
  const talkback = createAgentTalkback({ enabled: true, logger: captureLogger() });
  const init = await call(talkback, rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "probe", version: "0" } }));
  assert.equal(init.statusCode, 200);
  assert.equal(init.body.result.protocolVersion, "2025-03-26");
  assert.equal(init.body.result.serverInfo.name, "solvelang-agent-talkback");
  const ping = await call(talkback, rpc("ping"));
  assert.equal(ping.statusCode, 200);
  assert.deepEqual(ping.body.result, {});
  const list = await call(talkback, rpc("tools/list"));
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.body.result.tools.map((tool) => tool.name), ["get_runner_minutes_prices", "get_api_plans", "how_buying_works"]);
  for (const tool of list.body.result.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.inputSchema.properties, {});
  }
  const notification = await call(talkback, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
  assert.equal(notification.statusCode, 202);
});

test("each tool serves the exact pinned facts", async () => {
  const talkback = createAgentTalkback({ enabled: true, logger: captureLogger() });
  const prices = await call(talkback, rpc("tools/call", { name: "get_runner_minutes_prices" }));
  assert.equal(prices.statusCode, 200);
  assert.deepEqual(prices.body.result.structuredContent, RUNNER_MINUTES_FACTS);
  assert.deepEqual(JSON.parse(prices.body.result.content[0].text), RUNNER_MINUTES_FACTS);
  const plans = await call(talkback, rpc("tools/call", { name: "get_api_plans" }));
  assert.deepEqual(plans.body.result.structuredContent, API_PLAN_FACTS);
  const buying = await call(talkback, rpc("tools/call", { name: "how_buying_works" }));
  assert.equal(buying.body.result.content[0].text, HOW_BUYING_WORKS);
  assert.equal(buying.body.result.structuredContent, undefined);
});

test("tools take no arguments: any argument is rejected with HTTP 400", async () => {
  const talkback = createAgentTalkback({ enabled: true, logger: captureLogger() });
  for (const args of [{ pack: "standard" }, { minutes: 5000 }, ["standard"], "standard", 42]) {
    const outcome = await call(talkback, rpc("tools/call", { name: "get_runner_minutes_prices", arguments: args }));
    assert.equal(outcome.statusCode, 400, JSON.stringify(args));
    assert.equal(outcome.body.error.code, -32602);
  }
  const emptyObject = await call(talkback, rpc("tools/call", { name: "get_api_plans", arguments: {} }));
  assert.equal(emptyObject.statusCode, 200);
  const absent = await call(talkback, rpc("tools/call", { name: "get_api_plans" }));
  assert.equal(absent.statusCode, 200);
});

test("the surface cannot buy, charge, or read an account: action-shaped tools do not exist", async () => {
  const talkback = createAgentTalkback({ enabled: true, logger: captureLogger() });
  for (const name of ["buy_runner_minutes", "create_checkout", "charge_card", "get_account_balance", "get_my_minutes", "create_account", "purchase"]) {
    const outcome = await call(talkback, rpc("tools/call", { name }));
    assert.equal(outcome.statusCode, 400, name);
    assert.equal(outcome.body.error.code, -32602);
  }
  assert.deepEqual(AGENT_TOOL_NAMES, ["get_runner_minutes_prices", "get_api_plans", "how_buying_works"]);
  for (const name of AGENT_TOOL_NAMES) assert.doesNotMatch(name, /^(buy|charge|purchase|pay|create|update|delete|set)_/);
});

test("malformed and batched requests are rejected, unknown methods get a JSON-RPC error", async () => {
  const talkback = createAgentTalkback({ enabled: true, logger: captureLogger() });
  const malformed = await call(talkback, "{not json");
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.body.error.code, -32700);
  const batch = await call(talkback, JSON.stringify([JSON.parse(rpc("ping"))]));
  assert.equal(batch.statusCode, 400);
  assert.equal(batch.body.error.code, -32600);
  const unknown = await call(talkback, rpc("resources/list"));
  assert.equal(unknown.statusCode, 200);
  assert.equal(unknown.body.error.code, -32601);
});

test("rate limit: the per-source window refuses excess calls and recovers", async () => {
  let clock = 1_000_000;
  const logger = captureLogger();
  const talkback = createAgentTalkback({ enabled: true, logger, now: () => clock, rateLimit: { limit: 3, windowMs: 60_000 } });
  for (let i = 0; i < 3; i += 1) {
    const outcome = await call(talkback, rpc("ping"), { source: "198.51.100.7" });
    assert.equal(outcome.statusCode, 200);
  }
  const limited = await call(talkback, rpc("ping"), { source: "198.51.100.7" });
  assert.equal(limited.statusCode, 429);
  assert.equal(logger.lines.at(-1).outcome, "rate_limited");
  const otherSource = await call(talkback, rpc("ping"), { source: "198.51.100.9" });
  assert.equal(otherSource.statusCode, 200);
  clock += 60_001;
  const recovered = await call(talkback, rpc("ping"), { source: "198.51.100.7" });
  assert.equal(recovered.statusCode, 200);
  assert.equal(AGENT_RATE_LIMIT.limit, 60);
  assert.equal(AGENT_RATE_LIMIT.windowMs, 60_000);
});

test("every served tools/call is logged with its tool name", async () => {
  const logger = captureLogger();
  const talkback = createAgentTalkback({ enabled: true, logger });
  await call(talkback, rpc("tools/call", { name: "how_buying_works" }));
  const served = logger.lines.filter((line) => line.outcome === "served");
  assert.equal(served.length, 1);
  assert.equal(served[0].tool, "how_buying_works");
  assert.equal(typeof served[0].at, "string");
});

function apiEvent(method, rawPath, body) {
  return {
    rawPath,
    headers: {},
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    requestContext: { http: { method, sourceIp: "203.0.113.8" } },
  };
}

function handlerWith(agentTalkback) {
  return createApiAccessHandler({
    service: {},
    enabled: false,
    adminSecret: "a".repeat(64),
    siteOrigin: "https://www.solve-lang.com",
    agentTalkback,
    logger: captureLogger(),
  });
}

test("API handler serves the doorway end to end when enabled", async () => {
  const handler = handlerWith(createAgentTalkback({ enabled: true, logger: captureLogger() }));
  const init = await handler(apiEvent("POST", "/agent/mcp", { jsonrpc: "2.0", id: 7, method: "initialize", params: {} }));
  assert.equal(init.statusCode, 200);
  assert.equal(JSON.parse(init.body).result.serverInfo.name, "solvelang-agent-talkback");
  const prices = await handler(apiEvent("POST", "/agent/mcp", { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "get_runner_minutes_prices" } }));
  assert.equal(prices.statusCode, 200);
  const served = JSON.parse(prices.body).result.structuredContent;
  assert.deepEqual(served.highPower.packs.at(-1), { minutes: 10_000, price: 400 });
  const health = await handler(apiEvent("GET", "/health"));
  assert.equal(health.statusCode, 200);
});

test("API handler answers the disabled refusal when the doorway is off or absent", async () => {
  const off = handlerWith(createAgentTalkback({ enabled: false, logger: captureLogger() }));
  const offOutcome = await off(apiEvent("POST", "/agent/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }));
  assert.equal(offOutcome.statusCode, 503);
  assert.equal(JSON.parse(offOutcome.body).error, "agent_talkback_disabled");
  const absent = handlerWith(null);
  const absentOutcome = await absent(apiEvent("POST", "/agent/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }));
  assert.equal(absentOutcome.statusCode, 503);
  assert.equal(JSON.parse(absentOutcome.body).code, "agent_talkback_disabled");
});

test("template wires the gateway route and the kill-switch flag", async () => {
  const template = await readFile(new URL("../template.yaml", import.meta.url), "utf8");
  assert.match(template, /Path: \/agent\/\{proxy\+\}/);
  assert.match(template, /AGENT_TALKBACK_ENABLED: !Ref AgentTalkbackEnabled/);
  assert.match(template, /AgentTalkbackEnabled:\s*\n\s*Type: String\s*\n\s*Default: ""/);
});
