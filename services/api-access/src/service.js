import { bearerToken, fingerprintApiKey, generateApiKey, parseApiKey, verifyApiKeyFingerprint } from "./keys.js";
import { getApiPlan, usagePeriod } from "./plans.js";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["trialing", "active"]);
const ALL_SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due", "canceled", "unpaid", "incomplete"]);
const ALLOWED_SCOPES = new Set(["repository:audit"]);

export class ApiAccessError extends Error {
  constructor(statusCode, code, publicMessage) {
    super(publicMessage);
    this.name = "ApiAccessError";
    this.statusCode = statusCode;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

function cleanText(value, label, maximum = 160) {
  if (typeof value !== "string") throw new ApiAccessError(400, "invalid_request", `${label} is invalid.`);
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > maximum || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new ApiAccessError(400, "invalid_request", `${label} is invalid.`);
  }
  return cleaned;
}

function cleanId(value, label) {
  const cleaned = cleanText(value, label, 128);
  if (!/^[A-Za-z0-9_.:-]+$/.test(cleaned)) throw new ApiAccessError(400, "invalid_request", `${label} is invalid.`);
  return cleaned;
}

function cleanEmail(value) {
  const email = cleanText(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiAccessError(400, "invalid_request", "Email is invalid.");
  return email;
}

function cleanScopes(values, plan) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 8) {
    throw new ApiAccessError(400, "invalid_scopes", "At least one valid API scope is required.");
  }
  const scopes = [...new Set(values.map((value) => cleanText(value, "Scope", 80)))].sort();
  for (const scope of scopes) {
    if (!ALLOWED_SCOPES.has(scope) || !plan.scopes.includes(scope)) {
      throw new ApiAccessError(403, "scope_not_allowed", "The requested API scope is not available for this plan.");
    }
  }
  return scopes;
}

function subscriptionHasAccess(account, timestamp) {
  if (ACTIVE_SUBSCRIPTION_STATUSES.has(account.subscriptionStatus)) return true;
  return account.subscriptionStatus === "past_due"
    && Number.isSafeInteger(account.graceUntil)
    && account.graceUntil > timestamp;
}

function assertAccountAccess(account, timestamp) {
  if (!account) throw new ApiAccessError(403, "account_inactive", "API subscription access is unavailable.");
  if (!subscriptionHasAccess(account, timestamp)) {
    throw new ApiAccessError(403, "subscription_inactive", "The API subscription is not active.");
  }
  if (Number.isSafeInteger(account.currentPeriodEnd) && account.currentPeriodEnd <= timestamp && account.subscriptionStatus !== "past_due") {
    throw new ApiAccessError(403, "subscription_expired", "The API subscription period has ended.");
  }
}

function validateTimestamp(value, label, optional = false) {
  if (optional && value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) throw new ApiAccessError(400, "invalid_request", `${label} is invalid.`);
  return value;
}

function issuedKeyResponse(generated, record) {
  return {
    apiKey: generated.apiKey,
    env: `SOLVELANG_API_KEY=${generated.apiKey}\nSOLVELANG_API_BASE=https://api.solve-lang.com/v1\n`,
    key: {
      keyId: record.keyId,
      accountId: record.accountId,
      name: record.name,
      mode: record.mode,
      prefix: record.prefix,
      lastFour: record.lastFour,
      scopes: [...record.scopes],
      createdAt: record.createdAt,
    },
  };
}

export function createApiAccessService({ store, pepper, mode = "test", now = Date.now, randomBytes }) {
  if (!store || typeof store !== "object") throw new Error("API access store is required.");
  if (typeof pepper !== "string" || pepper.length < 32) throw new Error("API key pepper must contain at least 32 characters.");
  if (mode !== "test" && mode !== "live") throw new Error("API access mode must be test or live.");

  async function provisionSubscription(input) {
    const timestamp = now();
    const plan = getApiPlan(input.plan);
    const subscriptionStatus = cleanText(input.subscriptionStatus, "Subscription status", 32);
    if (!ALL_SUBSCRIPTION_STATUSES.has(subscriptionStatus)) {
      throw new ApiAccessError(400, "invalid_subscription_status", "Subscription status is invalid.");
    }
    const account = {
      accountId: cleanId(input.accountId, "Account ID"),
      email: cleanEmail(input.email),
      stripeCustomerId: cleanId(input.stripeCustomerId, "Stripe customer ID"),
      stripeSubscriptionId: cleanId(input.stripeSubscriptionId, "Stripe subscription ID"),
      plan: plan.name,
      subscriptionStatus,
      currentPeriodEnd: validateTimestamp(input.currentPeriodEnd, "Current period end"),
      subscriptionEventCreatedAt: validateTimestamp(input.subscriptionEventCreatedAt ?? timestamp, "Subscription event timestamp"),
      ...(input.graceUntil === undefined ? {} : { graceUntil: validateTimestamp(input.graceUntil, "Grace period end") }),
      updatedAt: new Date(timestamp).toISOString(),
    };
    const outcome = await store.putAccount(account);
    if (outcome === "stale") return await store.getAccount(account.accountId);
    return account;
  }

  async function issueApiKey(input) {
    const timestamp = now();
    const accountId = cleanId(input.accountId, "Account ID");
    const account = await store.getAccount(accountId);
    assertAccountAccess(account, timestamp);
    const plan = getApiPlan(account.plan);
    const scopes = cleanScopes(input.scopes ?? plan.scopes, plan);
    const name = cleanText(input.name, "API key name", 80);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generated = generateApiKey(mode, randomBytes);
      const record = {
        keyId: generated.keyId,
        accountId,
        name,
        mode,
        secretFingerprint: fingerprintApiKey({ ...generated, pepper }),
        prefix: generated.prefix,
        lastFour: generated.lastFour,
        scopes,
        createdAt: new Date(timestamp).toISOString(),
      };
      const outcome = await store.putKeyWithLimit(record, plan.maxActiveKeys);
      if (outcome === "created") return issuedKeyResponse(generated, record);
      if (outcome === "limit_reached") {
        throw new ApiAccessError(409, "key_limit_reached", "The active API key limit has been reached for this plan.");
      }
    }
    throw new ApiAccessError(503, "key_generation_failed", "A new API key could not be created.");
  }

  async function revokeApiKey(input) {
    const accountId = cleanId(input.accountId, "Account ID");
    const keyId = cleanId(input.keyId, "API key ID");
    const existing = await store.getKey(keyId);
    if (!existing || existing.accountId !== accountId) throw new ApiAccessError(404, "key_not_found", "API key was not found.");
    if (existing.revokedAt) return { keyId, revokedAt: existing.revokedAt, alreadyRevoked: true };
    const revokedAt = new Date(now()).toISOString();
    const outcome = await store.revokeKeyAndDecrement(keyId, accountId, revokedAt);
    if (outcome === "not_found") throw new ApiAccessError(404, "key_not_found", "API key was not found.");
    if (outcome === "already_revoked") {
      const latest = await store.getKey(keyId);
      return { keyId, revokedAt: latest?.revokedAt ?? revokedAt, alreadyRevoked: true };
    }
    return { keyId, revokedAt, alreadyRevoked: false };
  }

  async function authorize(input) {
    const rawKey = bearerToken(input.authorization);
    const parsed = parseApiKey(rawKey);
    if (parsed.mode !== mode) throw new ApiAccessError(401, "key_mode_mismatch", "API key is not valid for this environment.");
    const key = await store.getKey(parsed.keyId);
    if (!key || key.mode !== mode || key.revokedAt) throw new ApiAccessError(401, "invalid_api_key", "API key is invalid.");
    const presented = fingerprintApiKey({ ...parsed, pepper });
    if (!verifyApiKeyFingerprint({ presented, expectedHex: key.secretFingerprint })) {
      throw new ApiAccessError(401, "invalid_api_key", "API key is invalid.");
    }
    const timestamp = now();
    const account = await store.getAccount(key.accountId);
    assertAccountAccess(account, timestamp);
    const requiredScope = cleanText(input.requiredScope ?? "repository:audit", "Required scope", 80);
    if (!key.scopes.includes(requiredScope)) throw new ApiAccessError(403, "missing_scope", "API key does not have the required scope.");
    await store.touchKey(key.keyId, new Date(timestamp).toISOString());
    return {
      accountId: account.accountId,
      keyId: key.keyId,
      plan: account.plan,
      scopes: [...key.scopes],
      subscriptionStatus: account.subscriptionStatus,
    };
  }

  async function consumeUsage(input) {
    const timestamp = now();
    const accountId = cleanId(input.accountId, "Account ID");
    const account = await store.getAccount(accountId);
    assertAccountAccess(account, timestamp);
    const plan = getApiPlan(account.plan);
    const units = input.units ?? 1;
    if (!Number.isSafeInteger(units) || units < 1 || units > 1_000) {
      throw new ApiAccessError(400, "invalid_units", "Usage units are invalid.");
    }
    const idempotencyKey = cleanId(input.idempotencyKey, "Idempotency key");
    const period = usagePeriod(timestamp);
    const result = await store.consumeUsage({
      accountId,
      period,
      units,
      limit: plan.monthlyRequests,
      idempotencyKey,
      expiresAt: Math.floor(timestamp / 1_000) + 60 * 60 * 24 * 400,
    });
    if (result.status === "quota_exceeded") {
      throw new ApiAccessError(429, "monthly_quota_exceeded", "The monthly API request limit has been reached.");
    }
    if (result.status === "idempotency_conflict") {
      throw new ApiAccessError(409, "idempotency_conflict", "The idempotency key was already used with different usage units.");
    }
    return {
      accountId,
      plan: account.plan,
      period,
      used: result.used,
      limit: plan.monthlyRequests,
      remaining: Math.max(0, plan.monthlyRequests - result.used),
      duplicate: result.status === "duplicate",
    };
  }

  return { provisionSubscription, issueApiKey, revokeApiKey, authorize, consumeUsage };
}
