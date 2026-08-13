import {
  createHmac,
  randomBytes as nodeRandomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { ApiAccessError } from "./service.js";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const EMAIL_THROTTLE_MS = 60 * 1_000;
const SOURCE_THROTTLE_WINDOW_MS = 60 * 1_000;
const SOURCE_THROTTLE_LIMIT = 10;
const PASSWORD_IDENTIFIER_LIMIT = 5;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_SCHEME = "scrypt-v1";
const SESSION_COOKIE = "sl_api_session";
const scrypt = promisify(nodeScrypt);

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

function normalizeUsername(value) {
  if (typeof value !== "string") throw new ApiAccessError(400, "invalid_username", "Choose a valid username.");
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) || username.includes("@")) {
    throw new ApiAccessError(400, "invalid_username", "Use 3–32 letters, numbers, dots, underscores, or hyphens.");
  }
  return username;
}

function normalizeIdentifier(value) {
  if (typeof value !== "string") return undefined;
  const identifier = value.trim().toLowerCase();
  if (!identifier || identifier.length > 254) return undefined;
  if (identifier.includes("@")) {
    try {
      return { kind: "email", value: normalizeEmail(identifier) };
    } catch {
      return undefined;
    }
  }
  try {
    return { kind: "username", value: normalizeUsername(identifier) };
  } catch {
    return undefined;
  }
}

function passwordForLogin(value) {
  return typeof value === "string" && value.length > 0 && value.length <= PASSWORD_MAX_LENGTH ? value : undefined;
}

function passwordForSetup(value) {
  if (typeof value !== "string" || value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    throw new ApiAccessError(
      400,
      "invalid_password",
      `Use a password between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
  return value;
}

function normalizeSource(value) {
  if (typeof value !== "string") return "unknown";
  const source = value.trim();
  return source && source.length <= 128 && !/[\u0000-\u001f\u007f]/.test(source) ? source : "unknown";
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

function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${maxAge}`;
}

async function derivePassword(password, salt) {
  const result = await scrypt(password, Buffer.from(salt, "base64url"), 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return Buffer.from(result).toString("base64url");
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

  function createSession(timestamp) {
    const session = createOpaqueToken("sess", randomBytes);
    return {
      token: session.token,
      record: {
        sessionId: session.id,
        secretFingerprint: digest(pepper, "session", session.token),
        createdAt: new Date(timestamp).toISOString(),
        expiresAt: Math.floor((timestamp + SESSION_TTL_MS) / 1_000),
      },
    };
  }

  function sessionResult(session, accountId, email) {
    return {
      accountId,
      email,
      csrfToken: digest(pepper, "csrf", session.token),
      cookie: sessionCookie(session.token, Math.floor(SESSION_TTL_MS / 1_000)),
    };
  }

  async function requestMagicLink(input, context = {}) {
    const email = normalizeEmail(input?.email);
    const timestamp = now();
    const source = normalizeSource(context.sourceIp);
    const sourceThrottle = await store.reserveSourceRequest({
      sourceKey: digest(pepper, "source-throttle", source),
      window: Math.floor(timestamp / SOURCE_THROTTLE_WINDOW_MS),
      limit: SOURCE_THROTTLE_LIMIT,
      expiresAt: Math.floor((timestamp + 2 * SOURCE_THROTTLE_WINDOW_MS) / 1_000),
    });
    if (sourceThrottle === "limited") return { accepted: true };

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
    const session = createSession(timestamp);
    const result = await store.consumeMagicLinkAndCreateSession({
      tokenId: parsed.id,
      presentedFingerprint: digest(pepper, "magic-link", parsed.token),
      now: Math.floor(timestamp / 1_000),
      session: session.record,
    });
    if (!result?.accountId || !result?.email) {
      throw new ApiAccessError(401, "invalid_magic_link", "This sign-in link is invalid or expired.");
    }
    await store.ensureAccount({
      accountId: result.accountId,
      email: result.email,
      createdAt: new Date(timestamp).toISOString(),
    });
    return sessionResult(session, result.accountId, result.email);
  }

  async function loginWithPassword(input, context = {}) {
    const timestamp = now();
    const source = normalizeSource(context.sourceIp);
    const identifier = normalizeIdentifier(input?.identifier);
    const password = passwordForLogin(input?.password);
    const throttleWindow = Math.floor(timestamp / SOURCE_THROTTLE_WINDOW_MS);
    const expiresAt = Math.floor((timestamp + 2 * SOURCE_THROTTLE_WINDOW_MS) / 1_000);

    const sourceThrottle = await store.reserveSourceRequest({
      sourceKey: digest(pepper, "password-source", source),
      window: throttleWindow,
      limit: SOURCE_THROTTLE_LIMIT,
      expiresAt,
    });
    const identifierThrottle = await store.reserveSourceRequest({
      sourceKey: digest(pepper, "password-identifier", identifier?.value ?? "invalid"),
      window: throttleWindow,
      limit: PASSWORD_IDENTIFIER_LIMIT,
      expiresAt,
    });
    if (sourceThrottle === "limited" || identifierThrottle === "limited") {
      throw new ApiAccessError(429, "login_rate_limited", "Sign-in is temporarily unavailable. Try again shortly.");
    }

    let account;
    if (identifier?.kind === "email") {
      account = await store.getAccount(accountIdForEmail(identifier.value, pepper));
    } else if (identifier?.kind === "username") {
      const username = await store.getUsername(identifier.value);
      if (username?.accountId) account = await store.getAccount(username.accountId);
    }

    const fakeSalt = Buffer.from(digest(pepper, "password-dummy-salt", "constant").slice(0, 32), "hex").toString("base64url");
    const salt = account?.passwordScheme === PASSWORD_SCHEME && account?.passwordSalt ? account.passwordSalt : fakeSalt;
    const derived = await derivePassword(password ?? "invalid-password-value", salt);
    const matches = Boolean(
      password
      && account?.passwordScheme === PASSWORD_SCHEME
      && account?.passwordHash
      && secureEqual(derived, account.passwordHash),
    );
    if (!matches) {
      throw new ApiAccessError(401, "invalid_credentials", "Email/username or password is incorrect.");
    }

    const session = createSession(timestamp);
    await store.putSession({ session: session.record, accountId: account.accountId, email: account.email });
    return sessionResult(session, account.accountId, account.email);
  }

  async function getProfile(session) {
    const account = await store.getAccount(session?.accountId);
    return {
      username: account?.username ?? null,
      passwordConfigured: Boolean(
        account?.username
        && account?.passwordScheme === PASSWORD_SCHEME
        && account?.passwordHash
        && account?.passwordSalt,
      ),
    };
  }

  async function setCredentials(session, input) {
    if (!session?.accountId || !session?.email) {
      throw new ApiAccessError(401, "invalid_session", "Sign in again to continue.");
    }
    const username = normalizeUsername(input?.username);
    const password = passwordForSetup(input?.password);
    const timestamp = new Date(now()).toISOString();
    await store.ensureAccount({ accountId: session.accountId, email: session.email, createdAt: timestamp });

    const salt = randomBase64Url(16, randomBytes);
    const passwordHash = await derivePassword(password, salt);
    const result = await store.setCredentials({
      accountId: session.accountId,
      username,
      passwordSalt: salt,
      passwordHash,
      passwordScheme: PASSWORD_SCHEME,
      passwordUpdatedAt: timestamp,
    });
    if (result === "username_locked") {
      throw new ApiAccessError(409, "username_locked", "Your username cannot be changed from this screen.");
    }
    if (result !== "updated") {
      throw new ApiAccessError(409, "username_unavailable", "That username is unavailable.");
    }
    return { username, passwordConfigured: true };
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
    return sessionCookie("", 0);
  }

  return {
    requestMagicLink,
    verifyMagicLink,
    loginWithPassword,
    getProfile,
    setCredentials,
    authenticate,
    assertCsrf,
    logout,
  };
}
