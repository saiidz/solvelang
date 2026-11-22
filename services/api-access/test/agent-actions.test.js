import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GetCommand, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ApiAccessError } from "../src/service.js";
import { createDynamoAgentActionsStore } from "../src/agent-actions-store.js";
import { createAgentActionsService } from "../src/agent-actions-service.js";
import { AGENT_ACTION_TOOLS, createAgentActionsHandler } from "../src/agent-actions-handler.js";

// Level 3 (api-access) pins: delegated tokens are hashed at rest and
// shown once; the authenticated agent endpoint enforces scopes,
// rate limits and the kill switch; plan purchases default to human
// approval through the existing elements checkout and execute only
// under an armed API-plan mandate within caps; refusals are audited.

const PEPPER = "test-pepper-test-pepper-test-pepper-0123456789";

function fakeDocumentClient() {
  const items = new Map();
  return {
    items,
    async send(command) {
      if (command instanceof PutCommand) {
        items.set(command.input.Item.authKey, structuredClone(command.input.Item));
        return {};
      }
      if (command instanceof GetCommand) {
        const item = items.get(command.input.Key.authKey);
        return { Item: item ? structuredClone(item) : undefined };
      }
      if (command instanceof ScanCommand) {
        const prefix = command.input.ExpressionAttributeValues[":prefix"];
        return { Items: [...items.values()].filter((item) => item.authKey.startsWith(prefix)).map((item) => structuredClone(item)) };
      }
      if (command instanceof QueryCommand) {
        // Real DynamoDB semantics for this table (authKey is the
        // sole HASH key): a Query whose key condition is anything
        // but "=" on the partition key is a ValidationException.
        // The old fake answered it as a prefix filter, which is how
        // the broken store listing shipped green.
        const error = new Error("Invalid KeyConditionExpression: The expression can not use the function begins_with for the partition key authKey.");
        error.name = "ValidationException";
        throw error;
      }
      throw new Error("unexpected command");
    },
  };
}

// A minimal in-memory stand-in for the runners service's internal
// agent endpoints.
function fakeRunners({ mandates = [] } = {}) {
  const calls = [];
  const audit = [];
  const intents = new Map();
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ path, method: options.method ?? "GET", body });
    const respond = (status, payload) => ({ ok: status < 400, status, json: async () => payload });
    if (path === "/internal/agent/audit") { audit.push(body); return respond(201, { recorded: true }); }
    // The real runners service wraps every payload ({ intent },
    // { mandate }, { mandates }) and answers errors as
    // { error: <code>, message: <text> }. This fake mirrors those
    // envelopes exactly - the previous bare-object shapes are how
    // the contract breaks shipped green.
    if (path === "/internal/agent/purchase-intents" && options.method === "POST") {
      const intent = { id: "intent-min-1", tenantId: body.tenantId, packKey: body.packKey, amountCents: 2000, status: "approval_required", createdAt: "2026-11-19T12:00:00.000Z" };
      intents.set(intent.id, intent);
      return respond(201, { intent });
    }
    if (path.startsWith("/internal/agent/purchase-intents/")) {
      const parts = path.split("/");
      if (parts.length === 5) return respond(200, { intents: [...intents.values()] });
      const intent = intents.get(parts[5]);
      return intent ? respond(200, { intent }) : respond(404, { error: "purchase_not_found", message: "Purchase not found." });
    }
    if (path === "/internal/agent/mandates/draft") {
      const spec = body.spec ?? {};
      return respond(201, {
        mandate: {
          id: "mandate-draft-1", status: "draft", tenantId: body.tenantId,
          packKey: spec.packKey, thresholdSeconds: spec.thresholdSeconds,
          maxPerPurchaseCents: spec.perPurchaseCapCents, perPurchaseCapCents: spec.perPurchaseCapCents,
          monthlyCapCents: spec.monthlyCapCents, coversApiPlans: spec.coversApiPlans === true,
        },
      });
    }
    if (path.startsWith("/internal/agent/mandates/") && path.endsWith("/revoke")) {
      return respond(200, { mandate: { id: "mandate-1", status: "revoked" } });
    }
    if (path.startsWith("/internal/agent/mandates/")) return respond(200, { mandates });
    return respond(404, { error: "not_found", message: "Route not found." });
  };
  return { fetchImpl, calls, audit };
}

function makeService(overrides = {}) {
  const doc = fakeDocumentClient();
  const store = createDynamoAgentActionsStore(doc, "auth-table");
  const runners = fakeRunners(overrides.runnersOptions);
  const service = createAgentActionsService({
    store,
    pepper: PEPPER,
    runnersBaseUrl: "https://runners.example",
    runnersAdminToken: "admin-token",
    fetchImpl: runners.fetchImpl,
    elementsCheckout: overrides.elementsCheckout ?? null,
    subscriptionManagement: overrides.subscriptionManagement ?? null,
    subscriptionAccount: overrides.subscriptionAccount ?? null,
    accountEmail: overrides.accountEmail ?? (async () => "owner@example.com"),
    enabled: overrides.enabled ?? true,
    rateLimit: overrides.rateLimit,
  });
  return { service, store, doc, runners };
}

const customerAuth = {
  async authenticate() { return { accountId: "acct-a", csrfToken: "csrf-1" }; },
  assertCsrf(session, headerValue) {
    if (headerValue !== "csrf-1") {
      throw new ApiAccessError(403, "csrf_failed", "CSRF token mismatch.");
    }
  },
};

function event({ path, method = "POST", body, headers = {} }) {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers: { cookie: "sl_api_session=x", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

async function makeToken(service, scopes = ["purchase:runner-minutes", "purchase:api-plans", "mandates:manage", "purchases:read"]) {
  const created = await service.createToken({ accountId: "acct-a", label: "CI Agent", scopes });
  return { created, validated: await service.validateToken(created.token) };
}

test("kill switch: a disabled service refuses token creation and tool calls", async () => {
  const { service } = makeService({ enabled: false });
  await assert.rejects(
    () => service.createToken({ accountId: "acct-a", label: "CI Agent", scopes: ["purchases:read"] }),
    (error) => error.code === "agent_actions_disabled" && error.statusCode === 503,
  );
  await assert.rejects(
    () => service.callTool({ token: { accountId: "acct-a", tokenId: "t", label: "x", scopes: ["purchases:read"] }, name: "list_mandates", args: {} }),
    (error) => error.code === "agent_actions_disabled",
  );
});

test("tokens: shown once, hashed at rest, validated, revocable", async () => {
  const { service, doc } = makeService();
  const created = await service.createToken({ accountId: "acct-a", label: "Deploy Bot", scopes: ["purchases:read"] });
  assert.match(created.token, /^sla\./);
  const stored = [...doc.items.values()].find((item) => item.kind === "agent-token");
  assert.ok(stored, "token record stored");
  assert.equal(JSON.stringify(stored).includes(created.token.split(".")[3]), false, "the secret itself is never stored");
  assert.ok(stored.secretFingerprint, "only the fingerprint is stored");

  const validated = await service.validateToken(created.token);
  assert.equal(validated.accountId, "acct-a");
  assert.equal(validated.label, "Deploy Bot");
  assert.equal(await service.validateToken(created.token.replace(/.$/, "x")), null, "a wrong secret does not validate");
  assert.equal(await service.validateToken("sla.garbage"), null);

  const listed = await service.listTokens({ accountId: "acct-a" });
  assert.equal(listed.length, 1);
  assert.equal("secretFingerprint" in listed[0], false, "listings never expose the fingerprint");

  await service.revokeToken({ accountId: "acct-a", tokenId: created.tokenId });
  assert.equal(await service.validateToken(created.token), null, "a revoked token no longer validates");
});

test("tokens: labels and scopes are validated (owner default: free-text label, bounded)", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.createToken({ accountId: "acct-a", label: "bad;label!", scopes: ["purchases:read"] }),
    (error) => error.code === "agent_label_invalid",
  );
  await assert.rejects(
    () => service.createToken({ accountId: "acct-a", label: "Fine Label", scopes: ["admin:everything"] }),
    (error) => error.code === "agent_scopes_invalid",
  );
  await assert.rejects(
    () => service.createToken({ accountId: "acct-a", label: "Fine Label", scopes: [] }),
    (error) => error.code === "agent_scopes_invalid",
  );
});

test("handler: token management is session + CSRF bound; the MCP endpoint is token bound", async () => {
  const { service } = makeService();
  const handler = createAgentActionsHandler({ service, customerAuth, siteOrigin: "https://www.solve-lang.com", enabled: true });

  const created = await handler(event({
    path: "/customer/agent-tokens",
    headers: { "x-solvelang-csrf": "csrf-1" },
    body: { label: "CI Agent", scopes: ["purchase:runner-minutes", "purchases:read"] },
  }));
  assert.equal(created.statusCode, 201);
  const { token } = JSON.parse(created.body);

  const noCsrf = await handler(event({ path: "/customer/agent-tokens", body: { label: "X", scopes: ["purchases:read"] } }));
  assert.equal(noCsrf.statusCode, 403, "a CSRF failure never creates a token");

  const call = await handler(event({
    path: "/agent/actions",
    headers: { authorization: `Bearer ${token}` },
    body: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "purchase_runner_minutes", arguments: { pack: "standard-5000", idempotencyKey: "k-1" } } },
  }));
  assert.equal(call.statusCode, 200);
  const rpc = JSON.parse(call.body);
  assert.equal(rpc.result.structuredContent.status, "approval_required");
  assert.match(rpc.result.structuredContent.approvalUrl, /agent-access/);

  const unauthenticated = await handler(event({
    path: "/agent/actions",
    body: { jsonrpc: "2.0", id: 8, method: "tools/list", params: {} },
  }));
  assert.equal(unauthenticated.statusCode, 401);
});

test("handler: with the flag off, every Level 3 route answers 503 agent_actions_disabled", async () => {
  const { service } = makeService({ enabled: false });
  const handler = createAgentActionsHandler({ service, customerAuth, siteOrigin: "https://www.solve-lang.com", enabled: false });
  for (const path of ["/customer/agent-tokens", "/agent/actions", "/customer/agent-plan-purchases"]) {
    const response = await handler(event({ path, method: "GET" }));
    assert.equal(response.statusCode, 503, path);
    assert.ok(response.body.includes("agent_actions_disabled"), path);
  }
});

test("scope denial refuses the call and the refusal is audited", async () => {
  const { service, runners } = makeService();
  const { validated } = await makeToken(service, ["purchases:read"]);
  await assert.rejects(
    () => service.callTool({ token: validated, name: "purchase_runner_minutes", args: { pack: "standard-5000", idempotencyKey: "k" } }),
    (error) => error.code === "agent_scope_denied" && error.statusCode === 403,
  );
  assert.equal(runners.audit.length, 1);
  assert.equal(runners.audit[0].outcome, "refused_scope");
  assert.equal(runners.audit[0].agentLabel, "CI Agent");
});

test("rate limits refuse bursts per token", async () => {
  const { service } = makeService({ rateLimit: { perToken: { limit: 2, windowMs: 60_000 }, perAccount: { limit: 100, windowMs: 60_000 } } });
  const { validated } = await makeToken(service);
  await service.callTool({ token: validated, name: "list_mandates", args: {} });
  await service.callTool({ token: validated, name: "list_mandates", args: {} });
  await assert.rejects(
    () => service.callTool({ token: validated, name: "list_mandates", args: {} }),
    (error) => error.code === "agent_rate_limited" && error.statusCode === 429,
  );
});

test("mandate drafting through the endpoint is draft-only and labelled", async () => {
  const { service, runners } = makeService();
  const { validated } = await makeToken(service);
  const draft = await service.callTool({
    token: validated,
    name: "create_topup_mandate",
    args: { pool: "standard", pack: "standard-5000", thresholdSeconds: 600, perPurchaseCapCents: 2000, monthlyCapCents: 4000 },
  });
  assert.equal(draft.status, "draft");
  assert.match(draft.note, /account holder arms it/);
  const draftCall = runners.calls.find((call) => call.path === "/internal/agent/mandates/draft");
  assert.equal(draftCall.body.agentLabel, "CI Agent");
});

test("plan purchase defaults to approval, replays idempotently, and approves through the elements checkout", async () => {
  const checkoutCalls = [];
  const elementsCheckout = {
    async createElementsCheckout(input) {
      checkoutCalls.push(input);
      return { subscriptionId: "sub_1", customerId: "cus_1", paymentRequired: true, clientSecret: "pi_secret" };
    },
  };
  const { service } = makeService({ elementsCheckout });
  const { validated } = await makeToken(service);

  const prepared = await service.callTool({ token: validated, name: "purchase_api_plan", args: { plan: "pro", idempotencyKey: "plan-1" } });
  assert.equal(prepared.status, "approval_required");
  assert.equal(prepared.amountCents, 19900, "the pinned shelf price is what approval will charge");
  const replay = await service.callTool({ token: validated, name: "purchase_api_plan", args: { plan: "pro", idempotencyKey: "plan-1" } });
  assert.equal(replay.id, prepared.id, "a replay returns the original purchase");

  const approved = await service.approvePlanPurchase({ accountId: "acct-a", intentId: prepared.id });
  assert.equal(approved.status, "checkout_ready");
  assert.equal(approved.clientSecret, "pi_secret");
  assert.equal(checkoutCalls.length, 1);
  assert.equal(checkoutCalls[0].requestId, prepared.id, "the checkout reuses the intent id as its idempotency anchor");
  assert.equal(checkoutCalls[0].plan, "pro");
});

test("plan purchase under an armed API-plan mandate executes via plan change within caps", async () => {
  const mandate = {
    id: "m-api", status: "armed", coversApiPlans: true, pool: "standard", packKey: "standard-5000",
    perPurchaseCapCents: 100000, monthlyCapCents: 100000,
  };
  const changes = [];
  const subscriptionManagement = {
    async getManagement() {
      return { subscription: { plan: "developer", status: "active" }, paymentMethod: { id: "pm_1" }, attachedPaymentMethods: [{ id: "pm_1" }] };
    },
    async changePlan(input) { changes.push(input); return { subscription: { plan: input.plan, status: "active" } }; },
  };
  const { service } = makeService({ runnersOptions: { mandates: [mandate] }, subscriptionManagement });
  const { validated } = await makeToken(service);
  const result = await service.callTool({ token: validated, name: "purchase_api_plan", args: { plan: "business", idempotencyKey: "plan-mandate-1" } });
  assert.equal(result.status, "completed");
  assert.equal(result.mandateId, "m-api");
  assert.deepEqual(changes, [{ accountId: "acct-a", plan: "business" }]);
});

test("plan purchase over a mandate cap is refused whole and charges nothing", async () => {
  const mandate = {
    id: "m-api", status: "armed", coversApiPlans: true, pool: "standard", packKey: "standard-5000",
    perPurchaseCapCents: 10000, monthlyCapCents: 100000,
  };
  let changeCalls = 0;
  const subscriptionManagement = {
    async getManagement() {
      return { subscription: { plan: "developer", status: "active" }, paymentMethod: { id: "pm_1" }, attachedPaymentMethods: [] };
    },
    async changePlan() { changeCalls += 1; },
  };
  const { service, runners } = makeService({ runnersOptions: { mandates: [mandate] }, subscriptionManagement });
  const { validated } = await makeToken(service);
  const result = await service.callTool({ token: validated, name: "purchase_api_plan", args: { plan: "business", idempotencyKey: "plan-cap-1" } });
  assert.equal(result.status, "cap_blocked");
  assert.equal(changeCalls, 0);
  assert.ok(runners.audit.some((entry) => entry.outcome === "refused_cap"), "the refusal is audited");
});

test("a minutes-only mandate never executes a plan purchase (owner default)", async () => {
  const mandate = {
    id: "m-min", status: "armed", coversApiPlans: false, pool: "standard", packKey: "standard-5000",
    perPurchaseCapCents: 100000, monthlyCapCents: 100000,
  };
  let changeCalls = 0;
  const subscriptionManagement = {
    async getManagement() {
      return { subscription: { plan: "developer", status: "active" }, paymentMethod: { id: "pm_1" }, attachedPaymentMethods: [] };
    },
    async changePlan() { changeCalls += 1; },
  };
  const { service } = makeService({ runnersOptions: { mandates: [mandate] }, subscriptionManagement });
  const { validated } = await makeToken(service);
  const result = await service.callTool({ token: validated, name: "purchase_api_plan", args: { plan: "pro", idempotencyKey: "plan-min-only" } });
  assert.equal(result.status, "approval_required");
  assert.equal(changeCalls, 0);
});

test("module separation: the Level 2 read-only surface cannot reach Level 3 code", () => {
  const talkback = readFileSync(new URL("../src/agent-talkback.js", import.meta.url), "utf8");
  const talkbackImports = talkback.split("\n").filter((line) => line.startsWith("import"));
  assert.ok(talkbackImports.length > 0);
  for (const line of talkbackImports) {
    assert.match(line, /agent-facts\.js/, `talk-back may only import the facts module, found: ${line}`);
  }
  const service = readFileSync(new URL("../src/agent-actions-service.js", import.meta.url), "utf8");
  assert.doesNotMatch(service, /from "\.\/agent-talkback\.js"/, "Level 3 does not route through the read-only surface");
});

// ---- Contract pins for the Nov 19, 2026 launch-E2E defects ----
// Each side's suite used to mock this boundary with a shape the
// other side never sent; these tests pin the literal wire contract
// (the runners QA suite pins the same bodies from its side).

test("contract: create_topup_mandate sends the runners engine a nested spec in wire names", async () => {
  const { service, runners } = makeService();
  const { validated } = await makeToken(service);
  const draft = await service.callTool({
    token: validated,
    name: "create_topup_mandate",
    args: { pool: "standard", pack: "standard-5000", thresholdSeconds: 3600, perPurchaseCapCents: 2000, monthlyCapCents: 2000 },
  });
  // The tool result is the mandate itself - the runners { mandate }
  // envelope unwrapped - not the envelope.
  assert.equal(draft.id, "mandate-draft-1");
  assert.equal(draft.status, "draft");
  assert.equal(draft.thresholdSeconds, 3600);
  assert.equal(draft.perPurchaseCapCents, 2000);
  const draftCall = runners.calls.find((call) => call.path === "/internal/agent/mandates/draft");
  assert.deepEqual(draftCall.body, {
    tenantId: "acct-a",
    accountId: "acct-a",
    tokenId: validated.tokenId,
    agentLabel: "CI Agent",
    spec: {
      pool: "standard",
      packKey: "standard-5000",
      thresholdSeconds: 3600,
      perPurchaseCapCents: 2000,
      monthlyCapCents: 2000,
      coversApiPlans: false,
    },
  });
});

test("contract: a runners validation refusal reaches the agent with its own code and message", async () => {
  const doc = fakeDocumentClient();
  const store = createDynamoAgentActionsStore(doc, "auth-table");
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: "invalid_mandate", message: "Mandate monthly cap cannot be below its per-purchase cap." }),
  });
  const service = createAgentActionsService({
    store, pepper: PEPPER, runnersBaseUrl: "https://runners.example", runnersAdminToken: "admin-token",
    fetchImpl, enabled: true,
  });
  const { validated } = await makeToken(service);
  await assert.rejects(
    () => service.callTool({
      token: validated,
      name: "create_topup_mandate",
      args: { pool: "standard", pack: "standard-5000", thresholdSeconds: 3600, perPurchaseCapCents: 2000, monthlyCapCents: 1000 },
    }),
    (error) => error.code === "invalid_mandate"
      && error.publicMessage === "Mandate monthly cap cannot be below its per-purchase cap."
      && error.statusCode === 400,
  );
});

test("contract: purchase_runner_minutes returns the intent itself, with its approvalUrl", async () => {
  const { service } = makeService();
  const { validated } = await makeToken(service);
  const result = await service.callTool({
    token: validated, name: "purchase_runner_minutes",
    args: { pack: "standard-5000", idempotencyKey: "k-9" },
  });
  assert.equal(result.id, "intent-min-1");
  assert.equal(result.status, "approval_required");
  assert.equal(result.amountCents, 2000);
  assert.match(result.approvalUrl, /agent-access/);
  const status = await service.callTool({
    token: validated, name: "get_purchase_status", args: { purchaseId: "intent-min-1" },
  });
  assert.equal(status.id, "intent-min-1");
  assert.equal(status.status, "approval_required");
});

test("contract: the token list loads through the handler on the real store (the page's read)", async () => {
  const { service } = makeService();
  const handler = createAgentActionsHandler({ service, customerAuth, siteOrigin: "https://www.solve-lang.com", enabled: true });
  const created = await handler(event({
    path: "/customer/agent-tokens",
    headers: { "x-solvelang-csrf": "csrf-1" },
    body: { label: "CI Agent", scopes: ["purchases:read"] },
  }));
  assert.equal(created.statusCode, 201);
  const listed = await handler(event({ path: "/customer/agent-tokens", method: "GET" }));
  assert.equal(listed.statusCode, 200);
  const payload = JSON.parse(listed.body);
  assert.equal(payload.tokens.length, 1, "the created token lists (the Nov 19 page showed none)");
  assert.equal(payload.tokens[0].label, "CI Agent");
  assert.deepEqual(payload.tokens[0].scopes, ["purchases:read"]);
  assert.equal(payload.tokens[0].revokedAt, null);
  assert.ok(payload.tokens[0].createdAt);
});

test("store: prefix listing returns only the account's own records", async () => {
  const doc = fakeDocumentClient();
  const store = createDynamoAgentActionsStore(doc, "auth-table");
  await store.putToken({ accountId: "acct-a", tokenId: "t1", label: "A", scopes: ["purchases:read"], createdAt: "2026-11-19T00:00:00.000Z", revokedAt: null });
  await store.putToken({ accountId: "acct-b", tokenId: "t2", label: "B", scopes: ["purchases:read"], createdAt: "2026-11-19T00:00:00.000Z", revokedAt: null });
  await store.putPlanIntent({ accountId: "acct-a", id: "p1", status: "approval_required" });
  await store.putPlanIntent({ accountId: "acct-b", id: "p2", status: "approval_required" });
  assert.deepEqual((await store.listTokens("acct-a")).map((entry) => entry.tokenId), ["t1"]);
  assert.deepEqual((await store.listPlanIntents("acct-a")).map((entry) => entry.id), ["p1"]);
});


test("contract: create_topup_mandate forwards an agent's ops as an inert proposal, never as ops", async () => {
  const { service, runners } = makeService();
  const { validated } = await makeToken(service);
  const proposal = { poolShift: null, pause: { capFraction: 0.9, floorSeconds: null }, digestCadence: "weekly" };
  const draft = await service.callTool({
    token: validated,
    name: "create_topup_mandate",
    args: {
      pool: "standard", pack: "standard-5000", thresholdSeconds: 3600,
      perPurchaseCapCents: 2000, monthlyCapCents: 2000,
      ops: proposal,
    },
  });
  assert.equal(draft.status, "draft");
  const draftCall = runners.calls.find((call) => call.path === "/internal/agent/mandates/draft");
  // The proposal crosses the seam as opsProposal - the field the
  // runners engine stores inert on a draft (its QA suite pins the
  // landing). The mandate's own ops field is never sent by an
  // agent path: stating operations is the account holder's act.
  assert.deepEqual(draftCall.body.spec.opsProposal, proposal);
  assert.ok(!("ops" in draftCall.body.spec), "an agent path never sends the mandate's ops field");
});

test("contract: the create_topup_mandate schema advertises the ops proposal as optional", () => {
  const tool = AGENT_ACTION_TOOLS.find((entry) => entry.name === "create_topup_mandate");
  assert.ok(tool, "create_topup_mandate is listed on the MCP surface");
  assert.ok(tool.inputSchema.properties.ops, "ops is an advertised argument");
  assert.ok(!tool.inputSchema.required.includes("ops"), "ops stays optional");
});
