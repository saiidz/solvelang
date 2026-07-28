export function createApiKeyAuthorizer({ service, requiredScope = "repository:audit", enabled = false }) {
  if (!service || typeof service.authorize !== "function") throw new Error("API access service is required.");

  return async function authorizeRequest(event) {
    if (!enabled) return { isAuthorized: false };
    try {
      const authorization = event?.headers?.authorization ?? event?.headers?.Authorization ?? event?.identitySource?.[0];
      const context = await service.authorize({ authorization, requiredScope });
      return {
        isAuthorized: true,
        context: {
          accountId: context.accountId,
          keyId: context.keyId,
          plan: context.plan,
          scopes: context.scopes.join(" "),
          subscriptionStatus: context.subscriptionStatus,
        },
      };
    } catch {
      return { isAuthorized: false };
    }
  };
}
