import { createHmac, timingSafeEqual } from "node:crypto";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ApiAccessError } from "./service.js";

const SESSION_TOKEN = /^sess_([a-f0-9]{32})_([A-Za-z0-9_-]{43})$/;
const ACCOUNT_ID = /^acct_[a-f0-9]{32}$/;

function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function digest(pepper, label, value) {
  return createHmac("sha256", pepper).update(`${label}:${value}`).digest("hex");
}

// Every value presented under `name`, in header order — the Domain
// cookie and a host-only twin are distinct jar entries and either may
// be presented first (see customer-auth.js).
function cookieValues(cookieHeader, name) {
  if (typeof cookieHeader !== "string") return [];
  const values = [];
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) values.push(rest.join("="));
  }
  return values;
}

function authVersion(value) {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 1) return null;
  return value;
}

export function createPriorityCustomerSessionAuth({
  documentClient,
  tableName,
  pepper,
  previousPepper,
  accountAccess,
  now = Date.now,
  cookieName = "sl_api_session",
}) {
  if (!documentClient || typeof documentClient.send !== "function") throw new Error("DynamoDB document client is required.");
  if (typeof tableName !== "string" || !tableName) throw new Error("Customer auth table is required.");
  if (typeof pepper !== "string" || pepper.length < 32) throw new Error("Customer auth pepper must contain at least 32 characters.");
  if (previousPepper !== undefined && (typeof previousPepper !== "string" || previousPepper.length < 32)) {
    throw new Error("Previous customer auth pepper must contain at least 32 characters.");
  }
  // Dual-read rotation window: session and CSRF fingerprints minted under
  // the previous pepper keep verifying until the session expires.
  const pepperCandidates = [...new Set([pepper, previousPepper].filter((candidate) => typeof candidate === "string"))];
  if (!accountAccess || typeof accountAccess.assertActive !== "function") throw new Error("Account access verifier is required.");

  async function get(authKey) {
    const response = await documentClient.send(new GetCommand({
      TableName: tableName,
      Key: { authKey },
      ConsistentRead: true,
    }));
    return response.Item;
  }

  async function authenticateToken(token, match) {
    const [, sessionId, secret] = match;
    const session = await get(`session#${sessionId}`);
    const timestamp = Math.floor(now() / 1000);
    if (
      session?.kind !== "session"
      || !ACCOUNT_ID.test(session.accountId ?? "")
      || typeof session.email !== "string"
      || !Number.isSafeInteger(session.expiresAt)
      || session.expiresAt <= timestamp
      || !pepperCandidates.some((candidate) => secureEqual(session.secretFingerprint, digest(candidate, "session", token)))
    ) {
      throw new ApiAccessError(401, "session_invalid", "Customer session is invalid or expired.");
    }

    const account = await get(`account#${session.accountId}`);
    const sessionVersion = authVersion(session.authVersion);
    const accountVersion = authVersion(account?.authVersion);
    if (
      account?.kind !== "account"
      || account.accountId !== session.accountId
      || account.email !== session.email
      || sessionVersion === null
      || accountVersion === null
      || sessionVersion !== accountVersion
    ) {
      throw new ApiAccessError(401, "session_invalid", "Customer session is invalid or expired.");
    }
    await accountAccess.assertActive(session.accountId);
    return {
      accountId: session.accountId,
      email: session.email,
      csrfToken: session.csrfToken,
      csrfFingerprint: session.csrfFingerprint,
      authVersion: sessionVersion,
    };
  }

  return {
    async authenticate(cookieHeader) {
      // Same shadow rule as customer-auth.js: a jar can present the
      // Domain cookie and a stale host-only twin in either order, so
      // try EVERY presented value and accept the first that verifies;
      // fail closed only when none does. Only an invalid-session
      // rejection moves to the next candidate — an access restriction
      // (assertActive) or a store failure must still surface.
      let sawWellFormed = false;
      for (const token of cookieValues(cookieHeader, cookieName)) {
        const match = typeof token === "string" ? SESSION_TOKEN.exec(token) : null;
        if (!match) continue;
        sawWellFormed = true;
        try {
          return await authenticateToken(token, match);
        } catch (error) {
          if (!(error instanceof ApiAccessError) || error.code !== "session_invalid") throw error;
        }
      }
      if (sawWellFormed) throw new ApiAccessError(401, "session_invalid", "Customer session is invalid or expired.");
      throw new ApiAccessError(401, "session_required", "Customer authentication is required.");
    },

    assertCsrf(session, presented) {
      if (
        !session
        || typeof presented !== "string"
        || !presented
        || !pepperCandidates.some((candidate) => secureEqual(session.csrfFingerprint, digest(candidate, "csrf", presented)))
      ) {
        throw new ApiAccessError(403, "csrf_failed", "Request verification failed.");
      }
    },
  };
}
