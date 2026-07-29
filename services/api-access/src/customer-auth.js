import { createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";
import { ApiAccessError } from "./service.js";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const EMAIL_THROTTLE_MS = 60 * 1_000;
const SESSION_COOKIE = "sl_api_session";

function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeEmail(value) {
  if (typeof value !== "string") throw new ApiAccessError(400, "invalid_email", "Enter a valid email address.");
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiAccessError(400, "invalid_email", "Enter a valid email address.");
  }
  return email;
}

function digest(pepper, purpose, value) {
  return createHmac("sha256", pepper).update(`${purpose}:${value}`).digest("hex");
}

function randomBase64Url(size, randomBytes = nodeRandomBytes) {
  return Buffer.from(randomBytes(size)).toString("base64url");
}

function randomHex(size, randomBytes = nodeRandomBytes) {
  return Buffer.from(randomBytes(size)).toString("hex");
}

function createOpaqueToken(prefix, randomBytes) {
  const id = randomHex(12, randomBytes);
  const secret = randomBase64Url(32, randomBytes);
  return { id, secret, token: `${prefix}_${id}_${secret}` };
}

function parseOpaqueToken(value, prefix) {
  if (typeof value !== "string") throw new ApiAccessError(401, "invalid_session", "Sign in again to continue.");
  const match = value.match(new RegExp(`^${prefix}_([a-f0-9]{24})_([A-Za-z0-9_-]{43})$`));
  if (!match) throw new ApiAccessError(401, "invalid_session", "Sign in again to continue.");
  return { id: match[1], secret: match[2], token: value };
}

function cookieValue(cookieHeader, name) {
  if (typeof cookieHeader !== "string") return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function accountIdForEmail(email, pepper) {
  return `acct_${digest(pepper, "account", normalizeEmail(email)).slice(0, 32)}`;
}

export function createCustomerAuthService({
  store,
  emailGateway,
  pepper,
  siteOrigin,
  now = Date.now,
  randomBytes = nodeRandomBytes,
}) {
  if (!store || typeof store !== "object") throw new Error("Customer authentication store is required.");
  if (!emailGateway || typeof emailGateway.sendMagicLink !== "function") throw new Error("Customer email gateway is required.");
  if (typeof pepper !== "string" || pepper.length < 32) throw new Error("Customer authentication pepper must contain at least 32 characters.");
  if (typeof siteOrigin !== "string" || !/^https:\/\//.test(siteOrigin)) throw new Error("HTTPS site origin is required.");

  async function requestMagicLink(input) {
    const email = normalizeEmail(input?.email);
    const timestamp = now();
    const accountId = accountIdForEmail(email, pepper);
    const throttleKey = digest(pepper, "email-throttle", email);
    const throttle = await store.reserveEmailRequest({
      throttleKey,
      now: Math.floor(timestamp / 1_000),
      expiresAt: Math.floor((timestamp + EMAIL_THROTTLE_MS) / 1_000),
    });
    if (throttle === "limited") return { accepted: true };

    const generated = createOpaqueToken("ml", randomBytes);
    await store.putMagicLink({
      tokenId: generated.id,
      secretFingerprint: digest(pepper, "magic-link", generated.token),
      accountId,
      email,
      createdAt: new Date(timestamp).toISOString(),
      expiresAt: Math.floor((timestamp + MAGIC_LINK_TTL_MS) / 1_000),
    });
    const url = `${siteOrigin}/account/api-keys/#magic_token=${encodeURIComponent(generated.token)}`;
    await emailGateway.sendMagicLink({ email, url, expiresMinutes: 15 });
    return { accepted: true };
  }

  async function verifyMagicLink(input) {
    const parsed = parseOpaqueToken(input?.token, "ml");
    const timestamp = now();
    const session = createOpaqueToken("sess", randomBytes);
    const sessionRecord = {
      sessionId: session.id,
      secretFingerprint: digest(pepper, "session", session.token),
      createdAt: new Date(timestamp).toISOString(),
      expiresAt: Math.floor((timestamp + SESSION_TTL_MS) / 1_000),
    };
    const result = await store.consumeMagicLinkAndCreateSession({
      tokenId: parsed.id,
      presentedFingerprint: digest(pepper, "magic-link", parsed.token),
      now: Math.floor(timestamp / 1_000),
      session: sessionRecord,
    });
    if (!result?.accountId || !result?.email) {
      throw new ApiAccessError(401, "invalid_magic_link", "This sign-in link is invalid or expired.");
    }
    return {
      accountId: result.accountId,
      email: result.email,
      csrfToken: digest(pepper, "csrf", session.token),
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(session.token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1_000)}`,
    };
  }

  async function authenticate(cookieHeader) {
    const raw = cookieValue(cookieHeader, SESSION_COOKIE);
    const parsed = parseOpaqueToken(raw, "sess");
    const record = await store.getSession(parsed.id);
    const timestamp = Math.floor(now() / 1_000);
    const presented = digest(pepper, "session", parsed.token);
    if (!record || record.expiresAt <= timestamp || !secureEqual(presented, record.secretFingerprint)) {
      throw new ApiAccessError(401, "invalid_session", "Sign in again to continue.");
    }
    return {
      sessionId: parsed.id,
      accountId: record.accountId,
      email: record.email,
      csrfToken: digest(pepper, "csrf", parsed.token),
    };
  }

  function assertCsrf(session, presented) {
    if (!secureEqual(session?.csrfToken, presented)) {
      throw new ApiAccessError(403, "invalid_csrf", "The request could not be verified.");
    }
  }

  async function logout(cookieHeader) {
    const raw = cookieValue(cookieHeader, SESSION_COOKIE);
    if (raw) {
      try {
        const parsed = parseOpaqueToken(raw, "sess");
        await store.revokeSession(parsed.id, new Date(now()).toISOString());
      } catch (error) {
        if (!(error instanceof ApiAccessError)) throw error;
      }
    }
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  }

  return { requestMagicLink, verifyMagicLink, authenticate, assertCsrf, logout };
}
