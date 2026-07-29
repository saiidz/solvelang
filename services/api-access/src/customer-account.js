import { ApiAccessError } from "./service.js";
import { getApiPlan, usagePeriod } from "./plans.js";

function publicKey(record) {
  return {
    keyId: record.keyId,
    name: record.name,
    mode: record.mode,
    prefix: record.prefix,
    lastFour: record.lastFour,
    scopes: Array.isArray(record.scopes) ? [...record.scopes] : [],
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
  };
}

export function createCustomerAccountService({ store, apiAccessService, usageReader, now = Date.now }) {
  if (!store || typeof store.getAccount !== "function" || typeof store.listKeys !== "function") {
    throw new Error("API account store is required.");
  }
  if (!apiAccessService || typeof apiAccessService.issueApiKey !== "function") {
    throw new Error("API access service is required.");
  }
  if (!usageReader || typeof usageReader.getUsage !== "function") {
    throw new Error("API usage reader is required.");
  }

  async function getDashboard(session) {
    const account = await store.getAccount(session.accountId);
    const keys = (await store.listKeys(session.accountId)).map(publicKey).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    const period = usagePeriod(now());
    if (!account?.plan) {
      return {
        accountId: session.accountId,
        email: session.email,
        subscription: { plan: null, status: "none", currentPeriodEnd: null, graceUntil: null },
        usage: { period, used: null, limit: null, remaining: null },
        keys,
      };
    }
    const plan = getApiPlan(account.plan);
    const used = await usageReader.getUsage(session.accountId, period);
    return {
      accountId: session.accountId,
      email: session.email,
      subscription: {
        plan: plan.name,
        status: account.subscriptionStatus,
        currentPeriodEnd: account.currentPeriodEnd ?? null,
        graceUntil: account.graceUntil ?? null,
      },
      usage: {
        period,
        used,
        limit: plan.monthlyCredits,
        remaining: Math.max(0, plan.monthlyCredits - used),
      },
      keys,
    };
  }

  async function issueKey(session, input) {
    return apiAccessService.issueApiKey({
      accountId: session.accountId,
      name: input?.name,
      scopes: ["repository:audit"],
    });
  }

  async function revokeKey(session, input) {
    if (typeof input?.keyId !== "string") throw new ApiAccessError(400, "invalid_request", "API key is invalid.");
    return apiAccessService.revokeApiKey({ accountId: session.accountId, keyId: input.keyId });
  }

  return { getDashboard, issueKey, revokeKey };
}
