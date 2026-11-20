import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { ApiAccessError } from "./service.js";
import { API_PLAN_FACTS } from "./agent-facts.js";

// Level 3 agent actions for the api-access service (design §2, §3,
// §6): delegated agent tokens and the authenticated agent endpoint's
// tool implementations.
//
// MODULE SEPARATION (design §2): this module belongs to the Level 3
// surface only. The Level 2 read-only talk-back service
// (agent-talkback.js) imports nothing but the dependency-free facts
// module; it cannot reach tokens, accounts, Stripe, or this service.
// The one thing the two levels share is the pinned public shelf in
// agent-facts.js — imported here for the API plan prices, so an
// agent is quoted exactly what it is charged.
//
// MONEY PATHS: a runner-minutes purchase is prepared in the runners
// service (its own audit-first mandate engine) and completes through
// SolveLang's embedded checkout after human approval, or against the
// saved payment method under an armed mandate. An API-plan purchase
// completes through the existing elements subscription checkout
// after human approval, or — under an armed mandate that explicitly
// covers API plans, within its caps, on an account that already has
// a subscription with a payment method on file — through the
// existing plan-change machinery, which charges that saved method.
// Agents never see card data; no charge ever leaves these paths.

export const AGENT_TOKEN_SCOPES = Object.freeze([
  "purchase:runner-minutes",
  "purchase:api-plans",
  "mandates:manage",
  "purchases:read",
]);

export const AGENT_LABEL_MAX_LENGTH = 64;
const AGENT_LABEL_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._'’-]*$/u;

// Stricter than the Level 2 read-only limits (design §6): acting on
// an account is not browsing.
export const AGENT_ACTIONS_RATE_LIMIT = Object.freeze({
  perToken: Object.freeze({ limit: 30, windowMs: 60_000 }),
  perAccount: Object.freeze({ limit: 120, windowMs: 60_000 }),
});

const TOKEN_PREFIX = "sla";
const APPROVAL_URL = "https://www.solve-lang.com/account/agent-access/";

function fingerprint(pepper, secret) {
  return createHmac("sha256", pepper).update(`agent-token:${secret}`).digest("hex");
}

function encodeAccountId(accountId) {
  return Buffer.from(accountId, "utf8").toString("base64url");
}

function decodeAccountId(encoded) {
  try {
    const value = Buffer.from(encoded, "base64url").toString("utf8");
    return value || null;
  } catch {
    return null;
  }
}

export function cleanAgentLabel(value) {
  if (typeof value !== "string") {
    throw new ApiAccessError(400, "agent_label_invalid", "Agent label is required.");
  }
  const label = value.trim();
  if (!label || label.length > AGENT_LABEL_MAX_LENGTH || !AGENT_LABEL_PATTERN.test(label)) {
    throw new ApiAccessError(400, "agent_label_invalid", "Agent label must be 1-64 characters of letters, numbers, spaces and basic punctuation.");
  }
  return label;
}

export function cleanScopes(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiAccessError(400, "agent_scopes_invalid", "At least one scope is required.");
  }
  const scopes = [...new Set(value)];
  for (const scope of scopes) {
    if (!AGENT_TOKEN_SCOPES.includes(scope)) {
      throw new ApiAccessError(400, "agent_scopes_invalid", `Unknown scope: ${String(scope)}`);
    }
  }
  return scopes;
}

function tokenView(record) {
  return {
    tokenId: record.tokenId,
    label: record.label,
    scopes: record.scopes,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt ?? null,
    lastUsedAt: record.lastUsedAt ?? null,
  };
}

function planIntentView(record) {
  return {
    id: record.id,
    kind: "api-plan",
    plan: record.plan,
    amountCents: record.amountCents,
    currency: "USD",
    status: record.status,
    mandateId: record.mandateId ?? null,
    agentLabel: record.agentLabel ?? null,
    createdAt: record.createdAt,
    approvalUrl: record.status === "approval_required" ? APPROVAL_URL : null,
  };
}

// Fixed-window rate limiter. Windows live in this process (the
// Lambda execution environment), which bounds burst rates per
// instance; the limits are deliberately tight for an acting agent.
export function createRateLimiter({ now = Date.now } = {}) {
  const windows = new Map();
  return {
    check(key, { limit, windowMs }) {
      const at = now();
      const current = windows.get(key);
      if (!current || at - current.windowStart >= windowMs) {
        windows.set(key, { windowStart: at, count: 1 });
        return true;
      }
      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    },
  };
}

export function createAgentActionsService({
  store,
  pepper,
  runnersBaseUrl,
  runnersAdminToken,
  fetchImpl = fetch,
  elementsCheckout = null,
  subscriptionManagement = null,
  subscriptionAccount = null,
  accountEmail = null,
  enabled = false,
  opsEnabled = false,
  now = Date.now,
  logger = console,
  rateLimiter = createRateLimiter({ now }),
  rateLimit = AGENT_ACTIONS_RATE_LIMIT,
} = {}) {
  if (!store) throw new Error("Agent actions store is required.");
  if (typeof pepper !== "string" || !pepper) throw new Error("Agent actions pepper is required.");

  const runnersConfigured = typeof runnersBaseUrl === "string" && runnersBaseUrl
    && typeof runnersAdminToken === "string" && runnersAdminToken;

  function requireEnabled() {
    if (!enabled) {
      throw new ApiAccessError(503, "agent_actions_disabled", "Agent actions are not enabled.");
    }
  }

  // The Level 4 kill switch (design §6): its own flag, its own
  // error. While off, the Level 4 tool refuses and Level 3 is
  // completely unaffected.
  function requireOpsEnabled() {
    if (!opsEnabled) {
      throw new ApiAccessError(503, "agent_ops_disabled", "Agent operations are not enabled.");
    }
  }

  async function runners(path, { method = "GET", body } = {}) {
    if (!runnersConfigured) {
      throw new ApiAccessError(503, "agent_runners_unavailable", "The runner-minutes service is not configured for agent actions.");
    }
    let response;
    try {
      response = await fetchImpl(`${runnersBaseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: { "content-type": "application/json", "x-admin-token": runnersAdminToken },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiAccessError(502, "agent_runners_unavailable", "The runner-minutes service is unavailable.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      // The runners service answers errors as { error: <code>,
      // message: <text> } - the envelope its handler writes for every
      // route. Read the code from `error` and the text from
      // `message`, so a precise refusal (invalid_mandate, say)
      // reaches the agent as itself instead of degrading into a
      // generic runners error carrying the code as its message.
      throw new ApiAccessError(
        response.status >= 400 && response.status < 500 ? response.status : 502,
        payload.error || "agent_runners_error",
        payload.message || "The runner-minutes service refused the request.",
      );
    }
    return payload;
  }

  // Audit entries for outcomes decided in THIS service (scope
  // refusals, plan purchases) land in the same customer-readable
  // audit log the runners service keeps (design §5).
  async function audit({ accountId, token, action, outcome, summary, tool = null, mandateId = null }) {
    await runners("/internal/agent/audit", {
      method: "POST",
      body: {
        tenantId: accountId,
        tokenId: token?.tokenId ?? null,
        agentLabel: token?.label ?? null,
        tool,
        action,
        outcome,
        summary: summary ?? null,
        mandateId,
      },
    });
  }

  async function auditBestEffort(entry) {
    try {
      await audit(entry);
    } catch (error) {
      logger.error({ type: "agent_actions_audit_failed", code: error?.code ?? "unknown" });
    }
  }

  // --- Delegated tokens (design §2) ---

  async function createToken({ accountId, label, scopes }) {
    requireEnabled();
    const cleanLabel = cleanAgentLabel(label);
    const cleanScopeList = cleanScopes(scopes);
    const tokenId = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const record = {
      accountId,
      tokenId,
      label: cleanLabel,
      scopes: cleanScopeList,
      secretFingerprint: fingerprint(pepper, secret),
      createdAt: new Date(now()).toISOString(),
      revokedAt: null,
      lastUsedAt: null,
    };
    await store.putToken(record);
    // The full token is returned exactly once — here. Only its
    // fingerprint is ever stored.
    return {
      token: `${TOKEN_PREFIX}.${encodeAccountId(accountId)}.${tokenId}.${secret}`,
      ...tokenView(record),
    };
  }

  async function listTokens({ accountId }) {
    requireEnabled();
    const records = await store.listTokens(accountId);
    return records
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(tokenView);
  }

  async function revokeToken({ accountId, tokenId }) {
    requireEnabled();
    const record = await store.getToken(accountId, tokenId);
    if (!record) throw new ApiAccessError(404, "agent_token_not_found", "Agent token not found.");
    if (!record.revokedAt) {
      record.revokedAt = new Date(now()).toISOString();
      await store.putToken(record);
    }
    return tokenView(record);
  }

  async function validateToken(presented) {
    requireEnabled();
    if (typeof presented !== "string") return null;
    const parts = presented.split(".");
    if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;
    const accountId = decodeAccountId(parts[1]);
    const tokenId = parts[2];
    const secret = parts[3];
    if (!accountId || !tokenId || !secret) return null;
    const record = await store.getToken(accountId, tokenId);
    if (!record || record.revokedAt) return null;
    const expected = Buffer.from(record.secretFingerprint, "hex");
    const actual = Buffer.from(fingerprint(pepper, secret), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    record.lastUsedAt = new Date(now()).toISOString();
    await store.putToken(record).catch(() => {});
    return { accountId, tokenId, label: record.label, scopes: record.scopes };
  }

  function requireScope(token, scope, tool) {
    if (!token.scopes.includes(scope)) {
      const error = new ApiAccessError(403, "agent_scope_denied", `This token does not hold the ${scope} scope required for ${tool}.`);
      error.auditOutcome = "refused_scope";
      throw error;
    }
  }

  function checkRateLimits(token) {
    const tokenOk = rateLimiter.check(`token:${token.tokenId}`, rateLimit.perToken);
    const accountOk = rateLimiter.check(`account:${token.accountId}`, rateLimit.perAccount);
    if (!tokenOk || !accountOk) {
      const error = new ApiAccessError(429, "agent_rate_limited", "Agent rate limit exceeded. Slow down and retry shortly.");
      error.auditOutcome = "refused_rate_limit";
      throw error;
    }
  }

  // --- API plan purchases (design §3) ---

  function planFacts(planName) {
    const plan = API_PLAN_FACTS.plans.find((entry) => entry.name === planName);
    if (!plan) throw new ApiAccessError(400, "invalid_plan", "Plan must be one of: developer, pro, business.");
    return plan;
  }

  async function monthlySettledCents(accountId, at) {
    const month = new Date(at).toISOString().slice(0, 7);
    let total = 0;
    const planIntents = await store.listPlanIntents(accountId);
    for (const intent of planIntents) {
      if (intent.status === "completed" && String(intent.createdAt).startsWith(month)) total += intent.amountCents || 0;
    }
    if (runnersConfigured) {
      const minutes = await runners(`/internal/agent/purchase-intents/${encodeURIComponent(accountId)}`);
      for (const intent of minutes.intents ?? []) {
        if (intent.status === "completed" && String(intent.createdAt).startsWith(month)) total += intent.amountCents || 0;
      }
    }
    return total;
  }

  async function preparePlanPurchase({ token, plan, idempotencyKey }) {
    const facts = planFacts(plan);
    if (typeof idempotencyKey !== "string" || !idempotencyKey || idempotencyKey.length > 200) {
      throw new ApiAccessError(400, "idempotency_key_required", "An idempotencyKey is required for every purchase.");
    }
    const existing = (await store.listPlanIntents(token.accountId))
      .find((intent) => intent.idempotencyKey === idempotencyKey);
    if (existing) return planIntentView(existing);

    const amountCents = Math.round(facts.pricePerMonth * 100);
    const intent = {
      id: randomUUID(),
      accountId: token.accountId,
      plan: facts.name,
      amountCents,
      idempotencyKey,
      tokenId: token.tokenId,
      agentLabel: token.label,
      status: "approval_required",
      mandateId: null,
      subscriptionId: null,
      createdAt: new Date(now()).toISOString(),
    };

    // A mandate may execute this only when it explicitly covers API
    // plans (owner default: minutes-only unless named) and both caps
    // hold against settled spend across both pools.
    let mandate = null;
    if (runnersConfigured) {
      const { mandates } = await runners(`/internal/agent/mandates/${encodeURIComponent(token.accountId)}`);
      mandate = (mandates ?? []).find((entry) => entry.status === "armed" && entry.coversApiPlans === true) ?? null;
    }
    if (mandate) {
      intent.mandateId = mandate.id;
      const monthly = await monthlySettledCents(token.accountId, now());
      if (amountCents > mandate.perPurchaseCapCents || monthly + amountCents > mandate.monthlyCapCents) {
        intent.status = "cap_blocked";
        await store.putPlanIntent(intent);
        await audit({
          accountId: token.accountId, token, tool: "purchase_api_plan", action: "plan_purchase",
          outcome: "refused_cap", mandateId: mandate.id,
          summary: `${facts.displayName} plan purchase of $${facts.pricePerMonth} refused: mandate cap reached. Nothing was charged.`,
        });
        return planIntentView(intent);
      }
      // Execution rides the existing plan-change machinery, which
      // charges the subscription's saved payment method. Without an
      // active subscription and a method on file there is nothing to
      // charge — the purchase waits for human approval instead.
      let management = null;
      try {
        management = subscriptionManagement
          ? await subscriptionManagement.getManagement({ accountId: token.accountId })
          : null;
      } catch {
        management = null;
      }
      const hasSavedMethod = Boolean(management?.paymentMethod || (management?.attachedPaymentMethods ?? []).length > 0);
      const hasSubscription = ["active", "trialing"].includes(management?.subscription?.status ?? "");
      if (hasSubscription && hasSavedMethod && typeof subscriptionManagement.changePlan === "function") {
        await store.putPlanIntent(intent);
        await audit({
          accountId: token.accountId, token, tool: "purchase_api_plan", action: "plan_purchase",
          outcome: "prepared", mandateId: mandate.id,
          summary: `${facts.displayName} plan purchase of $${facts.pricePerMonth} prepared under an armed mandate.`,
        });
        await subscriptionManagement.changePlan({ accountId: token.accountId, plan: facts.name });
        intent.status = "completed";
        await store.putPlanIntent(intent);
        await audit({
          accountId: token.accountId, token, tool: "purchase_api_plan", action: "plan_purchase",
          outcome: "executed", mandateId: mandate.id,
          summary: `${facts.displayName} plan purchased for $${facts.pricePerMonth} under an armed mandate.`,
        });
        return planIntentView(intent);
      }
    }

    await store.putPlanIntent(intent);
    await audit({
      accountId: token.accountId, token, tool: "purchase_api_plan", action: "plan_purchase",
      outcome: "approval_required", mandateId: intent.mandateId,
      summary: `${facts.displayName} plan purchase of $${facts.pricePerMonth} prepared; waiting for the account holder's approval.`,
    });
    return planIntentView(intent);
  }

  // Human approval inside the signed-in account: hands the prepared
  // plan purchase to the existing embedded elements checkout. The
  // account holder completes payment on SolveLang's own page; the
  // subscription lifecycle takes it from there.
  async function approvePlanPurchase({ accountId, intentId }) {
    requireEnabled();
    const intent = await store.getPlanIntent(accountId, intentId);
    if (!intent) throw new ApiAccessError(404, "purchase_not_found", "Purchase not found.");
    if (intent.status === "completed") return planIntentView(intent);
    if (intent.status !== "approval_required" && intent.status !== "checkout_ready") {
      throw new ApiAccessError(409, "purchase_not_approvable", "This purchase cannot be approved in its current state.");
    }
    if (!elementsCheckout || typeof accountEmail !== "function") {
      throw new ApiAccessError(503, "plan_checkout_unavailable", "Plan checkout is not configured.");
    }
    const email = await accountEmail(accountId);
    const checkout = await elementsCheckout.createElementsCheckout({
      accountId,
      requestId: intent.id,
      email,
      plan: intent.plan,
    });
    intent.status = "checkout_ready";
    intent.subscriptionId = checkout.subscriptionId ?? null;
    await store.putPlanIntent(intent);
    return { ...planIntentView(intent), clientSecret: checkout.clientSecret ?? null, paymentRequired: checkout.paymentRequired === true };
  }

  async function rejectPlanPurchase({ accountId, intentId }) {
    requireEnabled();
    const intent = await store.getPlanIntent(accountId, intentId);
    if (!intent) throw new ApiAccessError(404, "purchase_not_found", "Purchase not found.");
    if (intent.status === "approval_required" || intent.status === "checkout_ready") {
      intent.status = "rejected";
      await store.putPlanIntent(intent);
      await auditBestEffort({
        accountId, token: null, tool: "purchase_api_plan", action: "plan_purchase",
        outcome: "rejected_by_owner",
        summary: `${intent.plan} plan purchase prepared by an agent was rejected by the account holder. Nothing was charged.`,
      });
    }
    return planIntentView(intent);
  }

  async function listPlanPurchases({ accountId }) {
    requireEnabled();
    const records = await store.listPlanIntents(accountId);
    return records
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(planIntentView);
  }

  // --- The tool surface (design §6) ---

  async function callTool({ token, name, args = {} }) {
    requireEnabled();
    try {
      checkRateLimits(token);
      switch (name) {
        case "purchase_runner_minutes": {
          requireScope(token, "purchase:runner-minutes", name);
          const { intent } = await runners("/internal/agent/purchase-intents", {
            method: "POST",
            body: {
              tenantId: token.accountId,
              packKey: args.pack,
              idempotencyKey: args.idempotencyKey,
              tokenId: token.tokenId,
              agentLabel: token.label,
            },
          });
          return { ...intent, approvalUrl: intent.status === "approval_required" ? APPROVAL_URL : null };
        }
        case "purchase_api_plan": {
          requireScope(token, "purchase:api-plans", name);
          return preparePlanPurchase({ token, plan: args.plan, idempotencyKey: args.idempotencyKey });
        }
        case "get_purchase_status": {
          requireScope(token, "purchases:read", name);
          const purchaseId = args.purchaseId;
          if (typeof purchaseId !== "string" || !purchaseId) {
            throw new ApiAccessError(400, "purchase_id_required", "purchaseId is required.");
          }
          const local = await store.getPlanIntent(token.accountId, purchaseId);
          if (local) {
            const view = planIntentView(local);
            if (view.status === "checkout_ready" && subscriptionAccount) {
              const account = await subscriptionAccount(token.accountId).catch(() => null);
              if (account?.stripeSubscriptionId && account.stripeSubscriptionId === local.subscriptionId
                && ["active", "trialing"].includes(account.subscriptionStatus ?? "")) {
                view.status = "completed";
              }
            }
            return view;
          }
          const { intent } = await runners(`/internal/agent/purchase-intents/${encodeURIComponent(token.accountId)}/${encodeURIComponent(purchaseId)}`);
          return intent;
        }
        case "list_mandates": {
          requireScope(token, "purchases:read", name);
          const { mandates } = await runners(`/internal/agent/mandates/${encodeURIComponent(token.accountId)}`);
          return { mandates };
        }
        case "create_topup_mandate": {
          requireScope(token, "mandates:manage", name);
          // Draft only — arming is a human act on the embedded
          // account page, never an agent act (design §6).
          const { mandate } = await runners("/internal/agent/mandates/draft", {
            method: "POST",
            body: {
              tenantId: token.accountId,
              accountId: token.accountId,
              tokenId: token.tokenId,
              agentLabel: token.label,
              // The runners engine reads a nested spec - that is its
              // handler contract. The tool's flat argument names are
              // the wire names the engine's validator accepts.
              spec: {
                pool: args.pool,
                packKey: args.pack,
                thresholdSeconds: args.thresholdSeconds,
                perPurchaseCapCents: args.perPurchaseCapCents,
                monthlyCapCents: args.monthlyCapCents,
                coversApiPlans: args.coversApiPlans === true,
                expiresAt: args.expiresAt,
              },
            },
          });
          return { ...mandate, note: "Draft created. A mandate does nothing until the account holder arms it inside their signed-in account." };
        }
        case "revoke_mandate": {
          requireScope(token, "mandates:manage", name);
          const { mandate } = await runners(`/internal/agent/mandates/${encodeURIComponent(token.accountId)}/${encodeURIComponent(args.mandateId)}/revoke`, {
            method: "POST",
            body: { tokenId: token.tokenId, agentLabel: token.label },
          });
          return mandate;
        }
        case "get_ops_digest": {
          // Level 4 (design §3/§4): the digest is a view over the
          // shared mandate ledger in the runners service — spend
          // vs caps, near-misses, escalations, decisions not to
          // act. Agents coordinate through that ledger and the
          // audit log; there is no agent-to-agent channel and no
          // A2A protocol claim (no settled standard exists).
          requireOpsEnabled();
          requireScope(token, "purchases:read", name);
          const { digest } = await runners(`/internal/agent/ops/digest/${encodeURIComponent(token.accountId)}`);
          return { digest };
        }
        default:
          throw new ApiAccessError(400, "unknown_tool", `Unknown tool: ${String(name)}`);
      }
    } catch (error) {
      // Refusals decided in this service are audited too (design
      // §5). Executions and preparations are audited by the runners
      // engine itself, audit-first.
      if (error instanceof ApiAccessError && error.auditOutcome) {
        await auditBestEffort({
          accountId: token.accountId, token, tool: name, action: "tool_call",
          outcome: error.auditOutcome, summary: error.publicMessage,
        });
      }
      throw error;
    }
  }

  return {
    createToken,
    listTokens,
    revokeToken,
    validateToken,
    callTool,
    approvePlanPurchase,
    rejectPlanPurchase,
    listPlanPurchases,
    requireEnabled,
  };
}
