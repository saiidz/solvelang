import { API_PLAN_FACTS, HOW_BUYING_WORKS, RUNNER_MINUTES_FACTS } from "./agent-facts.js";

// Agent talk-back doorway: a read-only MCP (JSON-RPC) surface that
// answers public questions about SolveLang — runner-minutes prices,
// API plan facts, and how buying works. It is a doorway for software
// agents to READ the same public shelf the website states, nothing
// more:
//
// - EXACTLY three tools, all parameterless. A tools/call carrying
//   arguments is rejected with HTTP 400 — there is no input through
//   which a caller could steer the surface toward anything else.
// - It imports only the dependency-free facts module (agent-facts.js).
//   It cannot reach account, tenant, ledger, balance, Stripe, or
//   GitHub code, so it cannot read private data and cannot initiate a
//   purchase, a checkout, or any account action — those exist only on
//   solve-lang.com, in the account holder's own session.
// - KILL SWITCH: the AGENT_TALKBACK_ENABLED flag (parsed in
//   config.js). Anything other than the exact value "true" leaves
//   every agent route answering 503 agent_talkback_disabled. To kill
//   the surface, set the flag off and redeploy (or update the function
//   configuration); to remove it entirely, delete the /agent/{proxy+}
//   gateway event and this route and redeploy.
// - Every call is logged (tool name, timestamp, outcome: served,
//   refused_disabled, rate_limited, rejected, method_not_allowed).
//   Calls are parameterless, so a log line never carries caller data
//   beyond the tool name.
// - Rate limit: a fixed window per source address (default 60 calls
//   per 60 seconds), enforced before any tool work happens.

export const AGENT_TALKBACK_PROTOCOL_VERSION = "2025-03-26";
export const AGENT_TALKBACK_SERVER_INFO = Object.freeze({ name: "solvelang-agent-talkback", version: "1.0.0" });
export const AGENT_RATE_LIMIT = Object.freeze({ limit: 60, windowMs: 60_000 });

const TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: "get_runner_minutes_prices",
    description:
      "The exact SolveLang Runner Minutes shelf: Standard and High-Power prepaid minute packs (USD, tax included), per-second metering with a 10-second minimum per job, Spot at 1x and guaranteed on-demand at 2x.",
    inputSchema: Object.freeze({ type: "object", properties: Object.freeze({}), additionalProperties: false }),
  }),
  Object.freeze({
    name: "get_api_plans",
    description:
      "The SolveLang API access plans: Developer $49/month, Pro $199/month, Business $699/month, with monthly weighted credits and active API key limits.",
    inputSchema: Object.freeze({ type: "object", properties: Object.freeze({}), additionalProperties: false }),
  }),
  Object.freeze({
    name: "how_buying_works",
    description:
      "How buying SolveLang runner minutes or an API plan works: account, SolveLang's own embedded payment pages (never an external checkout), balance credit, and one-time GitHub App connection. Explanation only — this surface cannot start a purchase.",
    inputSchema: Object.freeze({ type: "object", properties: Object.freeze({}), additionalProperties: false }),
  }),
]);

export const AGENT_TOOL_NAMES = Object.freeze(TOOL_DEFINITIONS.map((tool) => tool.name));

function toolResult(name) {
  if (name === "get_runner_minutes_prices") return RUNNER_MINUTES_FACTS;
  if (name === "get_api_plans") return API_PLAN_FACTS;
  return HOW_BUYING_WORKS;
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

export function createAgentTalkback({ enabled = false, logger = console, now = Date.now, rateLimit = AGENT_RATE_LIMIT } = {}) {
  const windows = new Map();

  function log(outcome, tool) {
    try {
      logger.info({ type: "agent_talkback_call", at: new Date(now()).toISOString(), tool: tool ?? null, outcome });
    } catch {
      // Logging must never break the surface it observes.
    }
  }

  function rateLimitAllows(source) {
    const key = typeof source === "string" && source ? source : "unknown";
    const at = now();
    const window = windows.get(key);
    if (!window || at - window.startedAt >= rateLimit.windowMs) {
      windows.set(key, { startedAt: at, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= rateLimit.limit;
  }

  function requestedTool(bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      return parsed?.method === "tools/call" && typeof parsed?.params?.name === "string" ? parsed.params.name : null;
    } catch {
      return null;
    }
  }

  // handle({ method, bodyText, source }) -> { statusCode, body }.
  // body is a JSON-serializable value; the API handler wraps it in the
  // service's standard JSON response.
  async function handle({ method, bodyText = "", source } = {}) {
    if (!enabled) {
      log("refused_disabled", requestedTool(bodyText));
      return {
        statusCode: 503,
        body: { error: "agent_talkback_disabled", message: "Agent talk-back is not enabled." },
      };
    }
    if (method !== "POST") {
      log("method_not_allowed", null);
      return {
        statusCode: 405,
        body: { error: "method_not_allowed", message: "The agent talk-back route only accepts POST." },
      };
    }
    if (!rateLimitAllows(source)) {
      log("rate_limited", requestedTool(bodyText));
      return { statusCode: 429, body: rpcError(null, -32029, "Rate limit exceeded. Try again later.") };
    }

    let request;
    try {
      request = JSON.parse(bodyText);
    } catch {
      log("rejected", null);
      return { statusCode: 400, body: rpcError(null, -32700, "Parse error: the request body must be a JSON-RPC object.") };
    }
    if (!request || typeof request !== "object" || Array.isArray(request) || typeof request.method !== "string") {
      log("rejected", null);
      return { statusCode: 400, body: rpcError(request?.id, -32600, "Invalid request: a single JSON-RPC object with a method is required.") };
    }

    const isNotification = request.id === undefined || request.method.startsWith("notifications/");
    if (isNotification) {
      log("served", null);
      return { statusCode: 202, body: {} };
    }

    if (request.method === "initialize") {
      log("served", null);
      return {
        statusCode: 200,
        body: rpcResult(request.id, {
          protocolVersion: AGENT_TALKBACK_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: AGENT_TALKBACK_SERVER_INFO,
        }),
      };
    }
    if (request.method === "ping") {
      log("served", null);
      return { statusCode: 200, body: rpcResult(request.id, {}) };
    }
    if (request.method === "tools/list") {
      log("served", null);
      return { statusCode: 200, body: rpcResult(request.id, { tools: TOOL_DEFINITIONS }) };
    }
    if (request.method === "tools/call") {
      const name = request.params?.name;
      if (typeof name !== "string" || !AGENT_TOOL_NAMES.includes(name)) {
        log("rejected", typeof name === "string" ? name : null);
        return { statusCode: 400, body: rpcError(request.id, -32602, `Unknown tool. Available tools: ${AGENT_TOOL_NAMES.join(", ")}.`) };
      }
      const args = request.params?.arguments;
      if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args) || Object.keys(args).length > 0)) {
        log("rejected", name);
        return { statusCode: 400, body: rpcError(request.id, -32602, `${name} takes no arguments.`) };
      }
      const facts = toolResult(name);
      log("served", name);
      return {
        statusCode: 200,
        body: rpcResult(request.id, {
          content: [{ type: "text", text: typeof facts === "string" ? facts : JSON.stringify(facts) }],
          ...(typeof facts === "string" ? {} : { structuredContent: facts }),
          isError: false,
        }),
      };
    }

    log("rejected", null);
    return { statusCode: 200, body: rpcError(request.id, -32601, `Method not found: ${request.method}`) };
  }

  return { handle };
}
