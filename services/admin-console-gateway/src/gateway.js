import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "__Host-solvelang-admin";
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function header(event, name) {
  return event?.headers?.[name.toLowerCase()] ?? event?.headers?.[name];
}

function bodyText(event) {
  if (!event?.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

function jsonBody(event) {
  const text = bodyText(event);
  return text ? JSON.parse(text) : {};
}

function cookieValue(event, name) {
  const raw = header(event, "cookie") ?? (Array.isArray(event?.cookies) ? event.cookies.join("; ") : "");
  for (const part of String(raw).split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function decode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function parseHash(encoded) {
  if (typeof encoded !== "string") return null;
  const [saltHex, keyHex, extra] = encoded.split(":");
  if (extra !== undefined || !/^[0-9a-f]{32,128}$/i.test(saltHex ?? "") || !/^[0-9a-f]{64,256}$/i.test(keyHex ?? "")) return null;
  return { salt: Buffer.from(saltHex, "hex"), expected: Buffer.from(keyHex, "hex") };
}

export function verifyAdminPassword(password, encodedHash) {
  const parsed = parseHash(encodedHash);
  if (!parsed || typeof password !== "string" || password.length < 12 || password.length > 512) return false;
  const actual = scryptSync(password, parsed.salt, parsed.expected.length, { N: 16384, r: 8, p: 1 });
  return actual.length === parsed.expected.length && timingSafeEqual(actual, parsed.expected);
}

export function createSessionCodec(secret, { now = () => Date.now(), random = randomBytes } = {}) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Admin session secret must contain at least 32 characters.");

  return {
    issue() {
      const payload = encode(JSON.stringify({
        v: 1,
        exp: Math.floor(now() / 1000) + ADMIN_SESSION_SECONDS,
        csrf: random(24).toString("base64url"),
        nonce: random(16).toString("base64url"),
      }));
      return `${payload}.${signature(secret, payload)}`;
    },
    read(token) {
      if (typeof token !== "string") return null;
      const [payload, presented, extra] = token.split(".");
      if (!payload || !presented || extra !== undefined || !secureEqual(presented, signature(secret, payload))) return null;
      try {
        const value = JSON.parse(decode(payload));
        if (value?.v !== 1 || !Number.isSafeInteger(value.exp) || value.exp <= Math.floor(now() / 1000)) return null;
        if (typeof value.csrf !== "string" || value.csrf.length < 24 || typeof value.nonce !== "string") return null;
        return value;
      } catch {
        return null;
      }
    },
  };
}

export function createLoginLimiter({ limit = 5, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const attempts = new Map();
  return {
    allow(key) {
      const timestamp = now();
      const current = attempts.get(key);
      if (!current || current.resetAt <= timestamp) {
        attempts.set(key, { count: 1, resetAt: timestamp + windowMs });
        return true;
      }
      current.count += 1;
      return current.count <= limit;
    },
    clear(key) {
      attempts.delete(key);
    },
  };
}

function response(origin, statusCode, body, cookies = []) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-solvelang-csrf",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      vary: "Origin",
    },
    ...(cookies.length ? { cookies } : {}),
    body: JSON.stringify(body),
  };
}

function assertOrigin(event, adminOrigin) {
  if (header(event, "origin") !== adminOrigin) {
    const error = new Error("origin_denied");
    error.statusCode = 403;
    throw error;
  }
}

function sessionCookie(token) {
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_SECONDS}`;
}

function clearCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function queryString(input = {}, keys) {
  const query = new URLSearchParams();
  for (const key of keys) {
    const value = input[key];
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const rendered = query.toString();
  return rendered ? `?${rendered}` : "";
}

function route(event) {
  const path = (event?.rawPath ?? "/").replace(/\/$/, "") || "/";
  const prefix = "/admin-gateway";
  return path.startsWith(prefix) ? path.slice(prefix.length) || "/" : path;
}

function guardedAccessMutation(event) {
  const body = jsonBody(event);
  if (body?.state !== "terminated") return event;
  const expected = `TERMINATE ${body.accountId ?? ""}`;
  if (!secureEqual(body.confirmation, expected)) {
    const error = new Error("termination_confirmation_required");
    error.statusCode = 400;
    throw error;
  }
  const { confirmation: _confirmation, ...upstreamBody } = body;
  return { ...event, body: JSON.stringify(upstreamBody), isBase64Encoded: false };
}

export function createAdminConsoleGateway({
  upstreamBase,
  upstreamSecret,
  adminOrigin,
  passwordHash,
  sessionSecret,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  random = randomBytes,
  logger = console,
}) {
  const upstream = new URL(upstreamBase);
  if (upstream.protocol !== "https:") throw new Error("Admin upstream API must use HTTPS.");
  if (typeof upstreamSecret !== "string" || upstreamSecret.length < 32) throw new Error("Admin upstream secret is required.");
  if (!/^https:\/\//.test(adminOrigin ?? "")) throw new Error("Admin origin must use HTTPS.");
  if (!parseHash(passwordHash)) throw new Error("Admin password scrypt hash is invalid.");
  const sessions = createSessionCodec(sessionSecret, { now, random });
  const limiter = createLoginLimiter({ now });

  async function proxy(event, method, path, mutation) {
    const token = cookieValue(event, ADMIN_COOKIE);
    const session = sessions.read(token);
    if (!session) return response(adminOrigin, 401, { error: "Authentication required.", code: "admin_session_required" });
    assertOrigin(event, adminOrigin);
    if (mutation && !secureEqual(header(event, "x-solvelang-csrf"), session.csrf)) {
      return response(adminOrigin, 403, { error: "Request verification failed.", code: "csrf_denied" });
    }

    const target = new URL(path, `${upstream.origin}/`);
    const upstreamResponse = await fetchImpl(target, {
      method,
      headers: {
        "content-type": "application/json",
        "x-solvelang-admin-secret": upstreamSecret,
      },
      ...(method === "POST" ? { body: bodyText(event) || "{}" } : {}),
    });
    const text = await upstreamResponse.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: "Upstream response was invalid.", code: "upstream_invalid" }; }
    return response(adminOrigin, upstreamResponse.status, payload);
  }

  return async function handle(event) {
    try {
      const method = event?.requestContext?.http?.method ?? "GET";
      const path = route(event);
      if (method === "OPTIONS") return response(adminOrigin, 204, {});

      if (method === "POST" && path === "/session/login") {
        assertOrigin(event, adminOrigin);
        const source = event?.requestContext?.http?.sourceIp ?? "unknown";
        if (!limiter.allow(source)) return response(adminOrigin, 429, { error: "Sign-in is temporarily unavailable.", code: "login_throttled" });
        const body = jsonBody(event);
        if (!verifyAdminPassword(body.password, passwordHash)) {
          logger.warn({ type: "admin_login_rejected" });
          return response(adminOrigin, 401, { error: "Invalid credentials.", code: "invalid_credentials" });
        }
        limiter.clear(source);
        const token = sessions.issue();
        const session = sessions.read(token);
        return response(adminOrigin, 200, { authenticated: true, csrfToken: session.csrf, expiresAt: session.exp }, [sessionCookie(token)]);
      }

      if (method === "GET" && path === "/session") {
        assertOrigin(event, adminOrigin);
        const session = sessions.read(cookieValue(event, ADMIN_COOKIE));
        if (!session) return response(adminOrigin, 401, { authenticated: false });
        return response(adminOrigin, 200, { authenticated: true, csrfToken: session.csrf, expiresAt: session.exp });
      }

      if (method === "POST" && path === "/session/logout") {
        const session = sessions.read(cookieValue(event, ADMIN_COOKIE));
        assertOrigin(event, adminOrigin);
        if (!session || !secureEqual(header(event, "x-solvelang-csrf"), session.csrf)) {
          return response(adminOrigin, 403, { error: "Request verification failed.", code: "csrf_denied" });
        }
        return response(adminOrigin, 200, { signedOut: true }, [clearCookie()]);
      }

      if (method === "GET" && path === "/customers") {
        return await proxy(event, "GET", `/internal/admin/customers${queryString(event?.queryStringParameters, ["accountId", "email", "username", "limit", "cursor"])}`, false);
      }
      if (method === "GET" && path === "/account-access") {
        return await proxy(event, "GET", `/internal/accounts/access${queryString(event?.queryStringParameters, ["accountId", "email", "username"])}`, false);
      }
      if (method === "POST" && path === "/account-access") return await proxy(guardedAccessMutation(event), "POST", "/internal/accounts/access", true);
      if (method === "POST" && path === "/crm/profile") return await proxy(event, "POST", "/internal/admin/customers/profile", true);
      if (method === "POST" && path === "/crm/notes") return await proxy(event, "POST", "/internal/admin/customers/notes", true);
      if (method === "POST" && path === "/crm/tasks") return await proxy(event, "POST", "/internal/admin/customers/tasks", true);
      if (method === "POST" && path === "/crm/tasks/update") return await proxy(event, "POST", "/internal/admin/customers/tasks/update", true);

      return response(adminOrigin, 404, { error: "Not found.", code: "not_found" });
    } catch (error) {
      if (error instanceof SyntaxError) return response(adminOrigin, 400, { error: "Invalid request.", code: "invalid_request" });
      if (error?.message === "origin_denied") return response(adminOrigin, 403, { error: "Origin denied.", code: "origin_denied" });
      if (error?.message === "termination_confirmation_required") {
        return response(adminOrigin, 400, { error: "Exact termination confirmation is required.", code: "termination_confirmation_required" });
      }
      logger.error({ type: "admin_gateway_error", code: "request_failed" });
      return response(adminOrigin, error?.statusCode ?? 500, { error: "Request failed.", code: "request_failed" });
    }
  };
}
