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

function cookieValue(cookieHeader, name) {
  if (typeof cookieHeader !== "string") return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
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
  accountAccess,
  now = Date.now,
  cookieName = "sl_api_session",
}) {
  if (!documentClient || typeof documentClient.send !== "function") throw new Error("DynamoDB document client is required.");
  if (typeof tableName !== "string" || !tableName) throw new Error("Customer auth table is required.");
  if (typeof pepper !== "string" || pepper.length < 32) throw new Error("Customer auth pepper must contain at least 32 characters.");
  if (!accountAccess || typeof accountAccess.assertActive !== "function") throw new Error("Account access verifier is required.");

  async function get(authKey) {
    const response = await documentClient.send(new GetCommand({
      TableName: tableName,
      Key: { authKey },
      ConsistentRead: true,
    }));
    return response.Item;
  }

  return {
    async authenticate(cookieHeader) {
      const token = cookieValue(cookieHeader, cookieName);
      const match = typeof token === "string" ? SESSION_TOKEN.exec(token) : null;
      if (!match) throw new ApiAccessError(401, "session_required", "Customer authentication is required.");
      const [, sessionId, secret] = match;
      const session = await get(`session#${sessionId}`);
      const timestamp = Math.floor(now() / 1000);
      if (
        session?.kind !== "session"
        || !ACCOUNT_ID.test(session.accountId ?? "")
        || typeof session.email !== "string"
        || !Number.isSafeInteger(session.expiresAt)
        || session.expiresAt <= timestamp
        || !secureEqual(session.secretFingerprint, digest(pepper, "session", token))
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
    },

    assertCsrf(session, presented) {
      if (
        !session
        || typeof presented !== "string"
        || !presented
        || !secureEqual(session.csrfFingerprint, digest(pepper, "csrf", presented))
      ) {
        throw new ApiAccessError(403, "csrf_failed", "Request verification failed.");
      }
    },
  };
}
