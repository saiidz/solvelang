import { ApiAccessError } from "./service.js";

// Level 3 agent actions HTTP surface (design §2, §6):
//   POST /agent/actions                  the authenticated agent
//                                        endpoint (MCP-style
//                                        JSON-RPC, Bearer token)
//   GET  /customer/agent-tokens          the account holder's token
//   POST /customer/agent-tokens          management (session +
//   POST /customer/agent-tokens/revoke   CSRF, like every customer
//                                        write)
//   GET  /customer/agent-plan-purchases  plan purchases an agent
//   POST .../approve | .../reject        prepared, for the account
//                                        holder to settle
//
// Kill switch: with the Level 3 flag off, every one of these routes
// answers 503 agent_actions_disabled — the surface exists in shape
// only (design §7). The read-only Level 2 doorway lives at
// /agent/mcp in agent-talkback.js and shares nothing with this
// handler beyond the pinned facts module.

export const AGENT_ACTIONS_PROTOCOL_VERSION = "2025-03-26";
export const AGENT_ACTIONS_SERVER_INFO = Object.freeze({ name: "solvelang-agent-actions", version: "1.0.0" });

export const AGENT_ACTION_TOOLS = Object.freeze([
  Object.freeze({
    name: "purchase_runner_minutes",
    description: "Prepare a purchase of a SolveLang runner-minutes pack for the account. Executes immediately only under an armed mandate within its caps and a saved payment method; otherwise returns status approval_required with an approvalUrl — the account holder approves inside their signed-in account and pays on SolveLang's embedded checkout. Requires scope purchase:runner-minutes.",
    inputSchema: {
      type: "object",
      properties: {
        pack: { type: "string", description: "Pack key, e.g. standard-5000, standard-25000, standard-100000, or a high-power pack key." },
        idempotencyKey: { type: "string", description: "Your unique key for this purchase. Replaying the same key returns the original purchase, never a second charge." },
      },
      required: ["pack", "idempotencyKey"],
      additionalProperties: false,
    },
  }),
  Object.freeze({
    name: "purchase_api_plan",
    description: "Prepare a purchase of a SolveLang API plan (developer $49/mo, pro $199/mo, business $699/mo). Same approval and mandate rules as runner minutes; a mandate covers API plans only when it explicitly says so. Requires scope purchase:api-plans.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", enum: ["developer", "pro", "business"] },
        idempotencyKey: { type: "string", description: "Your unique key for this purchase. Replaying the same key returns the original purchase, never a second charge." },
      },
      required: ["plan", "idempotencyKey"],
      additionalProperties: false,
    },
  }),
  Object.freeze({
    name: "get_purchase_status",
    description: "Read the current state of one purchase this account's agents prepared. Requires scope purchases:read.",
    inputSchema: {
      type: "object",
      properties: { purchaseId: { type: "string" } },
      required: ["purchaseId"],
      additionalProperties: false,
    },
  }),
  Object.freeze({
    name: "list_mandates",
    description: "List the account's standing top-up mandates and their states. Requires scope purchases:read.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  }),
  Object.freeze({
    name: "create_topup_mandate",
    description: "Create a DRAFT standing top-up mandate. A draft does nothing: only the account holder can arm a mandate, inside their signed-in account. The optional ops argument PROPOSES Level 4 standing operations for the draft: a proposal is stored inert and does nothing unless the account holder arms the mandate with it - an agent can propose operations, never set them. Requires scope mandates:manage.",
    inputSchema: {
      type: "object",
      properties: {
        pool: { type: "string", enum: ["standard", "high-power"] },
        pack: { type: "string", description: "Pack key to buy on each trigger, in the named pool." },
        thresholdSeconds: { type: "integer", description: "Trigger when the pool balance falls below this many seconds." },
        perPurchaseCapCents: { type: "integer", description: "Hard cap per single purchase, in cents." },
        monthlyCapCents: { type: "integer", description: "Hard cap on mandate spend per calendar month, in cents." },
        coversApiPlans: { type: "boolean", description: "Whether the mandate may also execute API plan purchases. Default false." },
        expiresAt: { type: "string", description: "Optional ISO expiry. Default 90 days after arming." },
        ops: {
          type: "object",
          description: "Optional PROPOSED standing operations (Level 4) for this draft: a pool shift, a pause lever, and a digest cadence. Stored inert as a proposal; only the account holder can turn a proposal into a mandate's stated operations, on the account page.",
          properties: {
            poolShift: {
              type: ["object", "null"],
              properties: {
                packKey: { type: "string", description: "Pack to buy instead when shifting - must be in the other pool." },
                shiftBelowSeconds: { type: "integer", description: "Shift when the balance falls below this many seconds." },
              },
              required: ["packKey", "shiftBelowSeconds"],
              additionalProperties: false,
            },
            pause: {
              type: ["object", "null"],
              properties: {
                capFraction: { type: "number", description: "Pause non-urgent work when the month's mandate spend reaches this fraction of the monthly cap (0-1)." },
                floorSeconds: { type: ["integer", "null"], description: "Optional balance floor for the pause lever, in seconds." },
              },
              additionalProperties: false,
            },
            digestCadence: { type: "string", enum: ["daily", "weekly"], description: "How often the operations digest is written. Default daily." },
          },
          additionalProperties: false,
        },
      },
      required: ["pool", "pack", "thresholdSeconds", "perPurchaseCapCents", "monthlyCapCents"],
      additionalProperties: false,
    },
  }),
  Object.freeze({
    name: "revoke_mandate",
    description: "Revoke a mandate immediately. Open preparations under it are refused; nothing further can execute under it. Requires scope mandates:manage.",
    inputSchema: {
      type: "object",
      properties: { mandateId: { type: "string" } },
      required: ["mandateId"],
      additionalProperties: false,
    },
  }),
  Object.freeze({
    name: "get_ops_digest",
    description: "Read the Level 4 operations digest for this account: spend vs mandate caps, near-misses at 80% of a cap, escalations, and the ops loop's decisions not to act. The digest is a view over the shared mandate ledger — agents acting under the same account coordinate through that ledger and the audit log; there is no direct agent-to-agent channel. Requires scope purchases:read. Refuses with agent_ops_disabled while Level 4 is off.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  }),
]);

function header(event, name) {
  return event?.headers?.[name.toLowerCase()] ?? event?.headers?.[name];
}

function cookieHeader(event) {
  const direct = header(event, "cookie");
  if (typeof direct === "string" && direct) return direct;
  if (!Array.isArray(event?.cookies)) return undefined;
  const cookies = event.cookies.filter((cookie) => typeof cookie === "string" && cookie);
  return cookies.length > 0 ? cookies.join("; ") : undefined;
}

function parseJson(event) {
  if (!event?.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return text ? JSON.parse(text) : {};
}

export function createAgentActionsHandler({ service, customerAuth, siteOrigin, enabled = false, logger = console }) {
  if (!service) throw new Error("Agent actions service is required.");
  if (!customerAuth || typeof customerAuth.authenticate !== "function" || typeof customerAuth.assertCsrf !== "function") {
    throw new Error("Customer authentication service is required.");
  }
  if (typeof siteOrigin !== "string" || !/^https:\/\//.test(siteOrigin)) throw new Error("HTTPS site origin is required.");

  function response(statusCode, body) {
    return {
      statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": siteOrigin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-solvelang-csrf,authorization",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        vary: "Origin",
      },
      body: JSON.stringify(body),
    };
  }

  function rpcResult(id, result) {
    return { jsonrpc: "2.0", id: id ?? null, result };
  }

  function rpcError(id, code, message, data) {
    return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
  }

  async function handleAgentEndpoint(event) {
    const body = parseJson(event);
    const authorization = header(event, "authorization") ?? "";
    const presented = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : null;
    const token = presented ? await service.validateToken(presented) : null;
    if (!token) {
      return response(401, rpcError(body?.id, -32001, "A valid delegated agent token is required.", { code: "agent_token_invalid" }));
    }
    const method = body?.method;
    if (method === "initialize") {
      return response(200, rpcResult(body.id, {
        protocolVersion: AGENT_ACTIONS_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: AGENT_ACTIONS_SERVER_INFO,
      }));
    }
    if (method === "ping") return response(200, rpcResult(body.id, {}));
    if (method === "notifications/initialized") return response(202, {});
    if (method === "tools/list") return response(200, rpcResult(body.id, { tools: AGENT_ACTION_TOOLS }));
    if (method === "tools/call") {
      const name = body?.params?.name;
      const args = body?.params?.arguments ?? {};
      const result = await service.callTool({ token, name, args });
      return response(200, rpcResult(body.id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false,
      }));
    }
    return response(200, rpcError(body?.id, -32601, `Method not found: ${String(method)}`));
  }

  async function handleCustomer(event, path, method) {
    const session = await customerAuth.authenticate(cookieHeader(event));
    if (path.endsWith("/customer/agent-tokens")) {
      if (method === "GET") {
        return response(200, { tokens: await service.listTokens({ accountId: session.accountId }), csrfToken: session.csrfToken });
      }
      if (method === "POST") {
        customerAuth.assertCsrf(session, header(event, "x-solvelang-csrf"));
        const body = parseJson(event);
        const created = await service.createToken({ accountId: session.accountId, label: body.label, scopes: body.scopes });
        return response(201, created);
      }
    }
    if (path.endsWith("/customer/agent-tokens/revoke")) {
      if (method !== "POST") return response(405, { error: "Method not allowed.", code: "method_not_allowed" });
      customerAuth.assertCsrf(session, header(event, "x-solvelang-csrf"));
      const body = parseJson(event);
      return response(200, await service.revokeToken({ accountId: session.accountId, tokenId: body.tokenId }));
    }
    if (path.endsWith("/customer/agent-plan-purchases")) {
      if (method === "GET") {
        return response(200, { purchases: await service.listPlanPurchases({ accountId: session.accountId }), csrfToken: session.csrfToken });
      }
      if (method === "POST") {
        customerAuth.assertCsrf(session, header(event, "x-solvelang-csrf"));
        const body = parseJson(event);
        if (body.action === "approve") {
          return response(200, await service.approvePlanPurchase({ accountId: session.accountId, intentId: body.intentId }));
        }
        if (body.action === "reject") {
          return response(200, await service.rejectPlanPurchase({ accountId: session.accountId, intentId: body.intentId }));
        }
        throw new ApiAccessError(400, "invalid_agent_plan_action", "Plan purchase action is invalid.");
      }
    }
    return response(404, { error: "Not found.", code: "not_found" });
  }

  return async function handle(event) {
    try {
      const method = event?.requestContext?.http?.method ?? "GET";
      const path = (event?.rawPath ?? "/").replace(/\/$/, "") || "/";
      if (method === "OPTIONS") return response(204, {});
      if (!enabled) throw new ApiAccessError(503, "agent_actions_disabled", "Agent actions are not enabled.");
      if (path.endsWith("/agent/actions")) {
        if (method !== "POST") return response(405, { error: "Method not allowed.", code: "method_not_allowed" });
        return await handleAgentEndpoint(event);
      }
      return await handleCustomer(event, path, method);
    } catch (error) {
      if (error instanceof ApiAccessError) {
        logger.error({ type: "agent_actions_error", code: error.code });
        const body = parseJson(event);
        if ((event?.rawPath ?? "").endsWith("/agent/actions") && body && typeof body === "object") {
          return response(error.statusCode, rpcError(body.id, -32000, error.publicMessage, { code: error.code }));
        }
        return response(error.statusCode, { error: error.publicMessage, code: error.code });
      }
      if (error instanceof SyntaxError) {
        return response(400, { error: "Invalid request.", code: "invalid_request" });
      }
      logger.error({ type: "agent_actions_error", code: "request_failed" });
      return response(500, { error: "Request failed.", code: "request_failed" });
    }
  };
}
