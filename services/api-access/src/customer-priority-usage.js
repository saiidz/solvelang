import { getApiPlan, usagePeriod } from "./plans.js";
import { ApiAccessError } from "./service.js";

function activeSubscription(account, now) {
  if (account?.subscriptionStatus === "active" || account?.subscriptionStatus === "trialing") return true;
  return account?.subscriptionStatus === "past_due"
    && Number.isSafeInteger(account.graceUntil)
    && now <= account.graceUntil;
}

export function createPriorityUsageService({ store, now = Date.now }) {
  if (!store || typeof store.getAccount !== "function" || typeof store.consumeUsage !== "function") {
    throw new Error("Priority usage store is required.");
  }

  return {
    async consumeUsage(input = {}) {
      if (typeof input.accountId !== "string" || !input.accountId) {
        throw new ApiAccessError(400, "invalid_account", "Account is invalid.");
      }
      if (!Number.isSafeInteger(input.credits) || input.credits < 1 || input.credits > 1_000_000) {
        throw new ApiAccessError(400, "invalid_usage", "Usage credits are invalid.");
      }
      if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 160) {
        throw new ApiAccessError(400, "invalid_idempotency_key", "Usage idempotency key is invalid.");
      }
      const timestamp = now();
      const account = await store.getAccount(input.accountId);
      if (!activeSubscription(account, timestamp)) {
        throw new ApiAccessError(403, "subscription_inactive", "API subscription is not active.");
      }
      let plan;
      try {
        plan = getApiPlan(account.plan);
      } catch {
        throw new ApiAccessError(403, "subscription_inactive", "API subscription is not active.");
      }
      const period = usagePeriod(timestamp);
      const result = await store.consumeUsage({
        accountId: input.accountId,
        period,
        credits: input.credits,
        limit: plan.monthlyCredits,
        idempotencyKey: input.idempotencyKey,
        now: timestamp,
      });
      if (result?.status === "quota_exceeded") {
        throw new ApiAccessError(429, "quota_exceeded", "Monthly API credit quota exceeded.");
      }
      if (result?.status === "idempotency_conflict") {
        throw new ApiAccessError(409, "idempotency_conflict", "Idempotency key was already used with different usage.");
      }
      if (result?.status !== "consumed" && result?.status !== "duplicate") {
        throw new Error("Priority usage store returned an invalid result.");
      }
      return {
        accountId: input.accountId,
        period,
        used: result.used,
        remaining: Math.max(plan.monthlyCredits - result.used, 0),
        limit: plan.monthlyCredits,
        charged: input.credits,
        duplicate: result.status === "duplicate",
      };
    },
  };
}
