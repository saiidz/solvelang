import { ApiAccessError } from "./service.js";
import { accountAccessState } from "./account-access.js";

function restricted() {
  return new ApiAccessError(403, "account_access_restricted", "Account access is unavailable.");
}

export function createAccessGuardedCustomerAuthStore(store, accessReader) {
  if (!store || typeof store !== "object") throw new Error("Customer authentication store is required.");
  if (!accessReader || typeof accessReader.getAccount !== "function") throw new Error("Account access reader is required.");

  async function assertActiveAccount(accountId, { allowMissing = false } = {}) {
    const account = await accessReader.getAccount(accountId);
    if (!account) {
      if (allowMissing) return undefined;
      throw restricted();
    }
    if (accountAccessState(account) !== "active") throw restricted();
    return account;
  }

  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "putMagicLink") {
        return async (record) => {
          await assertActiveAccount(record.accountId, { allowMissing: true });
          return target.putMagicLink(record);
        };
      }
      if (property === "consumeMagicLinkAndCreateSession" || property === "consumeMagicLinkForAuth") {
        return async (input) => {
          const magic = await accessReader.getRecord(`magic#${input.tokenId}`);
          if (magic?.accountId) await assertActiveAccount(magic.accountId);
          return target[property](input);
        };
      }
      if (property === "putSession" || property === "putMfaChallenge") {
        return async (input) => {
          await assertActiveAccount(input.accountId);
          return target[property](input);
        };
      }
      if (property === "consumeMfaChallengeAndCreateSession") {
        return async (input) => {
          await assertActiveAccount(input.challenge?.accountId);
          return target.consumeMfaChallengeAndCreateSession(input);
        };
      }
      if (property === "getSession") {
        return async (sessionId) => {
          const session = await target.getSession(sessionId);
          if (!session?.accountId) return session;
          try {
            await assertActiveAccount(session.accountId);
          } catch (error) {
            if (error instanceof ApiAccessError && error.code === "account_access_restricted") return undefined;
            throw error;
          }
          return session;
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}
