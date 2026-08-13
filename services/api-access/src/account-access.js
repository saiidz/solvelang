import { createHash } from "node:crypto";
import { ApiAccessError } from "./service.js";

export const ACCOUNT_ACCESS_ACTIVE = "active";
export const ACCOUNT_ACCESS_SUSPENDED = "suspended";
export const ACCOUNT_ACCESS_TERMINATED = "terminated";
const ACCOUNT_ACCESS_STATES = new Set([
  ACCOUNT_ACCESS_ACTIVE,
  ACCOUNT_ACCESS_SUSPENDED,
  ACCOUNT_ACCESS_TERMINATED,
]);

function cleanText(value, label, maximum) {
  if (typeof value !== "string") throw new ApiAccessError(400, "invalid_request", `${label} is invalid.`);
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > maximum || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new ApiAccessError(400, "invalid_request", `${label} is invalid.`);
  }
  return cleaned;
}

function cleanAccountId(value) {
  const cleaned = cleanText(value, "Account ID", 128);
  if (!/^acct_[a-f0-9]{32}$/.test(cleaned)) throw new ApiAccessError(400, "invalid_request", "Account ID is invalid.");
  return cleaned;
}

function cleanState(value) {
  if (typeof value !== "string" || !ACCOUNT_ACCESS_STATES.has(value)) {
    throw new ApiAccessError(400, "invalid_access_state", "Account access state is invalid.");
  }
  return value;
}

function cleanRequestId(value) {
  const cleaned = cleanText(value, "Request ID", 128);
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(cleaned)) throw new ApiAccessError(400, "invalid_request", "Request ID is invalid.");
  return cleaned;
}

function fingerprintRequest(requestId) {
  return createHash("sha256").update(requestId).digest("hex");
}

function requestMatches(record, { accountId, requestId, targetState, reason }) {
  return Boolean(
    record
    && record.kind === "access-request"
    && record.accountId === accountId
    && record.requestId === requestId
    && record.targetState === targetState
    && record.reason === reason,
  );
}

export function accountAccessState(account) {
  if (!account) return "missing";
  if (account.accessState === undefined) return ACCOUNT_ACCESS_ACTIVE;
  return ACCOUNT_ACCESS_STATES.has(account.accessState) ? account.accessState : "invalid";
}

export function accountIsActive(account) {
  return accountAccessState(account) === ACCOUNT_ACCESS_ACTIVE;
}

export function publicAccountAccess(account) {
  if (!account) throw new ApiAccessError(404, "account_not_found", "Account was not found.");
  const state = accountAccessState(account);
  if (state === "invalid") throw new ApiAccessError(409, "account_access_state_invalid", "Account access state requires administrative review.");
  return {
    accountId: account.accountId,
    state,
    reason: account.accessReason ?? null,
    changedAt: account.accessChangedAt ?? null,
    changedBy: account.accessChangedBy ?? null,
    authVersion: account.authVersion ?? 1,
  };
}

export function createAccountAccessService({ store, now = Date.now }) {
  if (!store || typeof store.getAccount !== "function") throw new Error("Account access reader is required.");

  async function getAccount(accountId) {
    return store.getAccount(cleanAccountId(accountId));
  }

  async function isActive(accountId) {
    return accountIsActive(await getAccount(accountId));
  }

  async function assertActive(accountId) {
    const account = await getAccount(accountId);
    if (!accountIsActive(account)) throw new ApiAccessError(403, "account_access_restricted", "Account access is unavailable.");
    return account;
  }

  async function getStatus(input) {
    const account = await getAccount(typeof input === "string" ? input : input?.accountId);
    return publicAccountAccess(account);
  }

  async function duplicateResult(record, account) {
    if (!account) throw new ApiAccessError(404, "account_not_found", "Account was not found.");
    return {
      ...publicAccountAccess(account),
      previousState: record.previousState,
      requestedState: record.targetState,
      changed: false,
      duplicate: true,
    };
  }

  async function transition(input, actor = "api-access-admin") {
    if (typeof store.transitionAccess !== "function" || typeof store.getRequest !== "function") {
      throw new Error("Account access mutation is not configured.");
    }
    const accountId = cleanAccountId(input?.accountId);
    const targetState = cleanState(input?.state);
    const reason = cleanText(input?.reason, "Reason", 512);
    const requestId = cleanRequestId(input?.requestId);
    const requestFingerprint = fingerprintRequest(requestId);
    const requestShape = { accountId, requestId, targetState, reason };

    const existingRequest = await store.getRequest(requestFingerprint);
    if (existingRequest) {
      if (!requestMatches(existingRequest, requestShape)) {
        throw new ApiAccessError(409, "idempotency_conflict", "Request ID was already used for a different account access change.");
      }
      return duplicateResult(existingRequest, await store.getAccount(accountId));
    }

    const account = await store.getAccount(accountId);
    if (!account) throw new ApiAccessError(404, "account_not_found", "Account was not found.");
    const previousState = accountAccessState(account);
    if (previousState === "invalid") {
      throw new ApiAccessError(409, "account_access_state_invalid", "Account access state requires administrative review.");
    }
    if (previousState === ACCOUNT_ACCESS_TERMINATED && targetState !== ACCOUNT_ACCESS_TERMINATED) {
      throw new ApiAccessError(409, "account_terminated", "A terminated account cannot be reactivated.");
    }
    if (previousState === targetState) {
      throw new ApiAccessError(409, "account_access_noop", "Account is already in the requested access state.");
    }

    const changedAt = new Date(now()).toISOString();
    const outcome = await store.transitionAccess({
      account,
      previousState,
      targetState,
      reason,
      changedAt,
      changedBy: actor,
      requestId,
      requestFingerprint,
    });
    if (outcome !== "updated") {
      const racedRequest = await store.getRequest(requestFingerprint);
      if (racedRequest) {
        if (!requestMatches(racedRequest, requestShape)) {
          throw new ApiAccessError(409, "idempotency_conflict", "Request ID was already used for a different account access change.");
        }
        return duplicateResult(racedRequest, await store.getAccount(accountId));
      }
      throw new ApiAccessError(409, "account_access_conflict", "Account access changed concurrently. Review the latest state and retry.");
    }
    const latest = await store.getAccount(accountId);
    return {
      ...publicAccountAccess(latest),
      previousState,
      requestedState: targetState,
      changed: true,
      duplicate: false,
    };
  }

  return { getStatus, transition, isActive, assertActive, getAccount };
}
