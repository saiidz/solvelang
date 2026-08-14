const GUARDED_METHODS = new Set([
  "reserveSubscriptionCheckout",
  "provisionSubscription",
  "issueApiKey",
  "consumeUsage",
]);

export function createAccessGuardedApiAccessService(service, accountAccess) {
  if (!service || typeof service !== "object") throw new Error("API access service is required.");
  if (!accountAccess || typeof accountAccess.assertActive !== "function") {
    throw new Error("Account access service is required.");
  }

  return new Proxy(service, {
    get(target, property, receiver) {
      if (GUARDED_METHODS.has(property)) {
        if (typeof target[property] !== "function") throw new Error(`API access service method ${String(property)} is unavailable.`);
        return async (input, ...rest) => {
          await accountAccess.assertActive(input?.accountId);
          return target[property](input, ...rest);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}
