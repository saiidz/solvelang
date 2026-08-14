import { ApiAccessError } from "./service.js";

export function createAccessGuardedCustomerAuthService(customerAuth) {
  if (!customerAuth || typeof customerAuth.requestMagicLink !== "function") {
    throw new Error("Customer authentication service is required.");
  }

  return new Proxy(customerAuth, {
    get(target, property, receiver) {
      if (property === "requestMagicLink") {
        return async (...args) => {
          try {
            return await target.requestMagicLink(...args);
          } catch (error) {
            if (error instanceof ApiAccessError && error.code === "account_access_restricted") {
              return { accepted: true };
            }
            throw error;
          }
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}
