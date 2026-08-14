import { accountIdForEmail } from "./customer-auth.js";
import { ApiAccessError } from "./service.js";

const ACCOUNT_ID_PATTERN = /^acct_[a-f0-9]{32}$/;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function invalidIdentity(message = "Account identifier is invalid.") {
  return new ApiAccessError(400, "invalid_request", message);
}

function normalizedUsername(value) {
  if (typeof value !== "string") throw invalidIdentity();
  const username = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) throw invalidIdentity("Username is invalid.");
  return username;
}

export function createAccountIdentityResolver({ store, pepper }) {
  if (!store || typeof store.getUsername !== "function") {
    throw new Error("Customer authentication identity store is required.");
  }
  if (typeof pepper !== "string" || pepper.length < 32) {
    throw new Error("Customer authentication pepper is required.");
  }

  return {
    async resolve(input = {}) {
      const candidates = [
        ["account_id", input.accountId],
        ["email", input.email],
        ["username", input.username],
      ].filter(([, value]) => typeof value === "string" && value.trim().length > 0);

      if (candidates.length !== 1) {
        throw invalidIdentity("Provide exactly one account identifier.");
      }

      const [matchedBy, value] = candidates[0];
      if (matchedBy === "account_id") {
        if (!ACCOUNT_ID_PATTERN.test(value)) throw invalidIdentity("Account ID is invalid.");
        return { accountId: value, matchedBy };
      }

      if (matchedBy === "email") {
        return {
          accountId: accountIdForEmail(value, pepper),
          matchedBy,
        };
      }

      const username = normalizedUsername(value);
      const mapping = await store.getUsername(username);
      if (!mapping) {
        throw new ApiAccessError(404, "account_not_found", "Account was not found.");
      }
      if (mapping.username !== username || !ACCOUNT_ID_PATTERN.test(mapping.accountId)) {
        throw new ApiAccessError(
          409,
          "account_identity_state_invalid",
          "Account identity requires administrative review.",
        );
      }
      return { accountId: mapping.accountId, matchedBy };
    },
  };
}
