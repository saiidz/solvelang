import test from "node:test";
import assert from "node:assert/strict";
import { GetCommand, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoAgentActionsStore } from "../src/agent-actions-store.js";
import { createAgentActionsService } from "../src/agent-actions-service.js";
import { AGENT_ACTION_TOOLS } from "../src/agent-actions-handler.js";

// Level 4 (api-access) pins for the get_ops_digest tool:
//   - the tool is listed on the MCP surface with an honest
//     description (coordination through the shared mandate
//     ledger; no agent-to-agent channel, no A2A claim);
//   - with AGENT_OPS_ENABLED off, the tool refuses 503
//     agent_ops_disabled — before any runners call — while the
//     Level 3 tools work exactly as before;
//   - the tool requires scope purchases:read;
//   - with the flag on, the tool proxies the runners service's
//     ops digest for the token's own account and returns it
//     under the { digest } envelope the runners side writes;
//   - a runners-side agent_ops_disabled (the runners kill switch
//     off while this one is on) reaches the agent as itself.

const PEPPER = "test-pepper-test-pepper-test-pepper-0123456789";

const DIGEST = {
  tenantId: "acct-a",
  generatedAt: "2026-11-19T12:00:00.000Z",
  periodDays: 7,
  mandates: [
    {
      id: "mandate-1", status: "armed", pool: "standard", packKey: "standard-5000",
      settledMonthCents: 2000, reservedMonthCents: 0, monthlyCapCents: 2500,
      utilization: 0.8, nearMiss: true,
    },
  ],
  spendByPoolCents: { standard: 2000, "high-power": 0 },
  actions: { topUpsTriggered: 1, poolShifts: 0, purchasesCompleted: 1, pauses: 0, resumes: 0, decisionsNotToAct: 2 },
  reservationsExpiredUnfulfilled: 0,
  nearMisses: [{ mandateId: "mandate-1", utilization: 0.8, monthlyCapCents: 2500 }],
  escalations: [],
  summaryLine: "Ops digest (7 days): spent $20.00 standard / $0.00 high-power; 1 top-up(s) triggered, 0 pause(s), 2 decision(s) not to act, 1 mandate(s) near their cap, 0 escalation(s).",
};

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
        // Faithful DynamoDB semantics for this table (authKey is
        // the sole HASH key): begins_with on the partition key is
        // a ValidationException, never a prefix filter.
        const error = new Error("Invalid KeyConditionExpression: The expression can not use the function begins_with for the partition key authKey.");
        error.name = "ValidationException";
        throw error;
      }
      throw new Error("unexpected command");
    },
  };
}

function fakeRunners({ digest = DIGEST, digestError = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: options.method ?? "GET" });
    const respond = (status, payload) => ({ ok: status < 400, status, json: async () => payload });
    if (path === "/internal/agent/audit") return respond(201, { recorded: true });
    if (path === "/internal/agent/ops/digest/acct-a") {
      if (digestError) return respond(digestError.status, { error: digestError.code, message: digestError.message });
      return respond(200, { digest });
    }
    if (path.startsWith("/internal/agent/mandates/")) return respond(200, { mandates: [] });
    return respond(404, { error: "not_found", message: "Route not found." });
  };
  return { fetchImpl, calls };
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
    enabled: overrides.enabled ?? true,
    opsEnabled: overrides.opsEnabled ?? false,
  });
  return { service, store, doc, runners };
}

async function tokenWithScopes(service, scopes) {
  const created = await service.createToken({ accountId: "acct-a", label: "Ops Agent", scopes });
  return service.validateToken(created.token);
}

test("the ops digest tool is listed with the honest coordination description", () => {
  const tool = AGENT_ACTION_TOOLS.find((entry) => entry.name === "get_ops_digest");
  assert.ok(tool, "get_ops_digest is listed on the MCP surface");
  assert.match(tool.description, /shared mandate ledger/);
  assert.match(tool.description, /no direct agent-to-agent channel/);
  assert.deepEqual(tool.inputSchema, { type: "object", properties: {}, additionalProperties: false });
});

test("kill switch: with Level 4 off, the digest tool refuses agent_ops_disabled and Level 3 is untouched", async () => {
  const { service, runners } = makeService({ opsEnabled: false });
  const token = await tokenWithScopes(service, ["purchases:read"]);
  await assert.rejects(
    () => service.callTool({ token, name: "get_ops_digest", args: {} }),
    (error) => error.statusCode === 503 && error.code === "agent_ops_disabled",
  );
  // The refusal happens before any runners call for the digest.
  assert.equal(runners.calls.filter((call) => call.path.includes("/ops/")).length, 0);
  // Level 3 tools answer exactly as before.
  const mandates = await service.callTool({ token, name: "list_mandates", args: {} });
  assert.deepEqual(mandates, { mandates: [] });
});

test("the digest tool requires the purchases:read scope", async () => {
  const { service } = makeService({ opsEnabled: true });
  const token = await tokenWithScopes(service, ["mandates:manage"]);
  await assert.rejects(
    () => service.callTool({ token, name: "get_ops_digest", args: {} }),
    (error) => error.statusCode === 403 && error.code === "agent_scope_denied",
  );
});

test("with Level 4 on, the tool returns the runners digest for the token's own account", async () => {
  const { service, runners } = makeService({ opsEnabled: true });
  const token = await tokenWithScopes(service, ["purchases:read"]);
  const result = await service.callTool({ token, name: "get_ops_digest", args: {} });
  assert.deepEqual(result, { digest: DIGEST });
  const digestCalls = runners.calls.filter((call) => call.path.startsWith("/internal/agent/ops/"));
  assert.equal(digestCalls.length, 1);
  assert.equal(digestCalls[0].path, "/internal/agent/ops/digest/acct-a");
  assert.equal(digestCalls[0].method, "GET");
});

test("a runners-side agent_ops_disabled reaches the agent as itself", async () => {
  const { service } = makeService({
    opsEnabled: true,
    runnersOptions: { digestError: { status: 503, code: "agent_ops_disabled", message: "Agent operations are not enabled." } },
  });
  const token = await tokenWithScopes(service, ["purchases:read"]);
  await assert.rejects(
    () => service.callTool({ token, name: "get_ops_digest", args: {} }),
    // The code and message survive the proxy exactly; the status
    // follows the runners() envelope rule (a runners 5xx surfaces
    // as 502, the same mapping every Level 3 tool lives under).
    (error) => error.code === "agent_ops_disabled" && error.statusCode === 502,
  );
});
