import { createHash } from "node:crypto";

function requestIdempotencyKey(event) {
  const requestId = event?.requestContext?.requestId;
  if (typeof requestId !== "string" || !requestId || requestId.length > 256) {
    throw new Error("API request identifier is unavailable.");
  }
  return `request_${createHash("sha256").update(requestId).digest("hex")}`;
}

export function createApiKeyAuthorizer({ service, requiredScope = "repository:audit", enabled = false }) {
  if (!service || typeof service.authorize !== "function" || typeof service.consumeUsage !== "function") {
    throw new Error("API access service is required.");
  }

  return async function authorizeRequest(event) {
    if (!enabled) return { isAuthorized: false };
    try {
      const authorization = event?.headers?.authorization ?? event?.headers?.Authorization ?? event?.identitySource?.[0];
      const context = await service.authorize({ authorization, requiredScope });
      const usage = await service.consumeUsage({
        accountId: context.accountId,
        credits: 1,
        idempotencyKey: requestIdempotencyKey(event),
      });
      return {
        isAuthorized: true,
        context: {
          accountId: context.accountId,
          keyId: context.keyId,
          plan: context.plan,
          scopes: context.scopes.join(" "),
          subscriptionStatus: context.subscriptionStatus,
          usageRemaining: usage.remaining,
        },
      };
    } catch {
      return { isAuthorized: false };
    }
  };
}
